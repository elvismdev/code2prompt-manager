#!/usr/bin/env node

const { program } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const packageJson = require('./package.json');

// Configuration constants
const CONFIG = {
	// Default directories to exclude
	COMMON_EXCLUDE_DIRS: [
		'node_modules',
		'.git',
		'vendor',
		'.next',
		'dist',
		'build',
		'.husky',
		'public',
		'docs',
		'assets/fonts',
		'assets/images',
		'assets/svg',
		'src/assets/images',
		'assets/icons',
		'languages',
		'images',
		'tests',
	],
	// Default file patterns to exclude
	COMMON_EXCLUDE_FILES: [
		'screenshot.png',
		'screenshot.jpg',
		'package-lock.json',
		'composer.lock',
		'yarn.lock',
		'*.min.js',
		'*.min.css'
	]
};

// Utility functions
const utils = {
	// Get current directory name for default output file
	getCurrentDirectoryName() {
		const currentPath = process.cwd();
		return path.basename(currentPath) + '.md';
	},

	// Format file sizes for display
	formatSize(bytes) {
		const units = ['B', 'KB', 'MB', 'GB'];
		let size = bytes;
		let unitIndex = 0;

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}

		return `${size.toFixed(2)} ${units[unitIndex]}`;
	},

	// Calculate directory size recursively
	getDirSize(dirPath) {
		let totalSize = 0;

		try {
			const entries = fs.readdirSync(dirPath);

			for (const entry of entries) {
				const entryPath = path.join(dirPath, entry);

				try {
					const stats = fs.statSync(entryPath);

					if (stats.isDirectory()) {
						totalSize += this.getDirSize(entryPath);
					} else {
						totalSize += stats.size;
					}
				} catch (err) {
					// Skip files/directories we can't access
				}
			}
		} catch (err) {
			// Skip directories we can't read
		}

		return totalSize;
	},

	// Pattern matching for file and directory paths
	isPathExcluded(itemPath, pattern, isDirectory = false) {
		// For directory patterns with '/**'
		if (pattern.endsWith('/**')) {
			const dirName = pattern.slice(0, -3);

			// For top-level directories
			if (!dirName.includes('/')) {
				return itemPath === dirName || itemPath.startsWith(dirName + '/');
			}
			// For path-specified directories
			else {
				return itemPath === dirName || itemPath.startsWith(dirName + '/');
			}
		}
		// For exact file matches (no wildcards)
		else if (!pattern.includes('*')) {
			return itemPath === pattern;
		}
		// For other wildcard patterns
		else {
			const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
			return regex.test(itemPath);
		}
	},

	// Check if item is excluded by any pattern in the list
	isExcluded(itemPath, excludePatterns, isDirectory = false) {
		return excludePatterns.some(pattern =>
			this.isPathExcluded(itemPath, pattern, isDirectory));
	},

	// Log with color
	log: {
		info: (msg) => console.log(chalk.blue(msg)),
		success: (msg) => console.log(chalk.green(msg)),
		warning: (msg) => console.log(chalk.yellow(msg)),
		error: (msg) => console.error(chalk.red(msg))
	}
};

// Set up command line options
function setupCommandLine() {
	program
		.name('code2prompt-manager')
		.description('A CLI tool to manage code2prompt file size limits')
		.version(packageJson.version)
		.option('-l, --limit <size>', 'Size limit for the generated MD file in KB',
			(value) => parseInt(value, 10), 400)
		.option('-d, --directory <path>', 'Directory to scan', '.')
		.option('-e, --extra-exclude <patterns>', 'Additional exclude patterns (comma-separated)')
		.option('-i, --include <patterns>', 'Include patterns (comma-separated)')
		.option('-O, --output-file <file>', 'Output file name', utils.getCurrentDirectoryName())
		.option('-F, --output-format <format>', 'Output format: markdown, json, or xml', 'markdown')
		.option('--include-priority', 'Include files in case of conflict between include and exclude patterns')
		.option('--full-directory-tree', 'List the full directory tree')
		.option('-c, --encoding <encoding>', 'Optional tokenizer to use for token count (cl100k, p50k, etc.)')
		.option('--line-numbers', 'Add line numbers to the source code')
		.option('-n, --no-execute', 'Only show the command, don\'t execute it')
		.option('--auto-exclude', 'Automatically exclude files to stay under size limit', false);

	program.parse(process.argv);
	return program.opts();
}

// Prepare exclude directories list
function getExcludeDirs(options) {
	// Default directories to skip during scanning
	const skipDirs = [...CONFIG.COMMON_EXCLUDE_DIRS];

	// Add extra exclude directories from command line
	if (options.extraExclude) {
		options.extraExclude.split(',').forEach(pattern => {
			pattern = pattern.trim();
			// For directory patterns with '/**'
			if (pattern.endsWith('/**')) {
				const dirName = pattern.slice(0, -3);
				if (!skipDirs.includes(dirName)) {
					skipDirs.push(dirName);
				}
			}
			// For simple directory names without wildcards
			else if (!pattern.includes('*')) {
				if (!skipDirs.includes(pattern)) {
					skipDirs.push(pattern);
				}
			}
		});
	}

	return skipDirs;
}

// Get files and directories recursively
function scanDirectory(rootDir, skipDirs) {
	const items = [];

	function scan(dir, baseDir = '') {
		try {
			const entries = fs.readdirSync(dir);

			for (const entry of entries) {
				const fullPath = path.join(dir, entry);
				const relativePath = path.join(baseDir, entry);

				try {
					const stats = fs.statSync(fullPath);

					if (stats.isDirectory()) {
						// Check if this directory should be skipped
						const shouldSkip = skipDirs.some(skipPath => {
							// For top-level directories (e.g., "styles")
							if (!skipPath.includes('/')) {
								return entry === skipPath && baseDir === '';
							}
							// For path-specified directories (e.g., "components/annual-report-2022/styles")
							else {
								return relativePath === skipPath;
							}
						});

						if (shouldSkip) {
							items.push({
								path: relativePath,
								isDirectory: true,
								size: 0,
								prettySize: utils.formatSize(0)
							});
							continue;
						}

						// Add the directory
						const dirSize = utils.getDirSize(fullPath);
						items.push({
							path: relativePath,
							isDirectory: true,
							size: dirSize,
							prettySize: utils.formatSize(dirSize)
						});

						// Scan subdirectory
						scan(fullPath, relativePath);
					} else {
						// Add the file
						items.push({
							path: relativePath,
							isDirectory: false,
							size: stats.size,
							prettySize: utils.formatSize(stats.size)
						});
					}
				} catch (err) {
					utils.log.warning(`Warning: Could not access ${fullPath}: ${err.message}`);
				}
			}
		} catch (err) {
			utils.log.warning(`Warning: Could not read directory ${dir}: ${err.message}`);
		}
	}

	// Start scanning from the root directory
	scan(rootDir);

	// Sort items by size (largest first)
	return items.sort((a, b) => b.size - a.size);
}

// Prepare exclude patterns
function prepareExcludePatterns(options) {
	// Default excludes
	const defaultExcludes = [
		// Add directory patterns with /**
		...CONFIG.COMMON_EXCLUDE_DIRS.map(dir => `${dir}/**`),
		// Add file patterns
		...CONFIG.COMMON_EXCLUDE_FILES
	];

	// Add extra exclude patterns from command line
	const extraExcludes = [];
	if (options.extraExclude) {
		options.extraExclude.split(',').forEach(pattern => {
			pattern = pattern.trim();
			if (pattern) {
				// Add '/**' suffix for directory patterns that don't have wildcards
				if (!pattern.includes('*') &&
					fs.existsSync(path.join(options.directory, pattern)) &&
					fs.statSync(path.join(options.directory, pattern)).isDirectory()) {
					extraExcludes.push(pattern + '/**');
				} else {
					extraExcludes.push(pattern);
				}
			}
		});
	}

	return { defaultExcludes, extraExcludes, allExcludes: [...defaultExcludes, ...extraExcludes] };
}

// Estimate the final size after excluding files
function estimateFinalSize(items, excludePatterns) {
	let totalSize = 0;

	// Sum sizes of all files that are not excluded
	items.forEach(item => {
		if (!item.isDirectory && !utils.isExcluded(item.path, excludePatterns)) {
			totalSize += item.size;
		}
	});

	// Add some overhead for markdown formatting
	const markdownOverhead = Math.min(items.length * 100, 50 * 1024); // ~100 bytes per file, max 50KB

	return totalSize + markdownOverhead;
}

// Create choices for selection UI
function createSelectionChoices(items, allExcludes) {
	// Create file choices
	const fileChoices = items
		.filter(item => !item.isDirectory) // Only include files in the choices
		.sort((a, b) => b.size - a.size)
		.map(item => {
			const sizeStr = item.prettySize.padStart(10);
			const pathStr = item.path;

			return {
				name: `${sizeStr} │ ${pathStr}`,
				value: item.path,
				short: item.path,
				size: item.size, // Store size for auto-exclude feature
				checked: utils.isExcluded(item.path, allExcludes)
			};
		});

	// Create directory choices
	const directoryChoices = items
		.filter(item => item.isDirectory)
		.sort((a, b) => b.size - a.size)
		.map(item => {
			const sizeStr = item.prettySize.padStart(10);
			const pathStr = item.path + '/';

			return {
				name: `${sizeStr} │ ${pathStr}`,
				value: `${item.path}/**`,
				short: item.path,
				checked: utils.isExcluded(item.path, allExcludes, true)
			};
		});

	return {
		fileChoices,
		directoryChoices,
		allChoices: [
			new inquirer.Separator(' === Files (sorted by size) === '),
			...fileChoices,
			new inquirer.Separator(' === Directories === '),
			...directoryChoices
		]
	};
}

// Auto-exclude large files to stay under the size limit
function autoExcludeFiles(choices, initialSize, sizeLimit, autoExclude) {
	const autoExcluded = [];

	if (autoExclude && initialSize > sizeLimit) {
		let remainingSize = initialSize;
		const targetSize = sizeLimit * 0.95; // Target 95% of limit to allow some margin

		// Sort files by size (largest first) that aren't already excluded
		const filesToConsider = [...choices]
			.filter(choice => !choice.checked)
			.sort((a, b) => b.size - a.size);

		for (const file of filesToConsider) {
			if (remainingSize > targetSize) {
				file.checked = true;
				autoExcluded.push(file.value);
				remainingSize -= file.size;
			} else {
				break;
			}
		}

		if (autoExcluded.length > 0) {
			utils.log.warning(`\nAuto-excluded ${autoExcluded.length} files to meet size limit:`);
			autoExcluded.forEach(file => {
				utils.log.warning(`  - ${file}`);
			});
			utils.log.success(`New estimated size: ${utils.formatSize(remainingSize)}`);
		}
	}

	return autoExcluded;
}

// Build the code2prompt command
function buildCommand(options, allExcludes) {
	let cmd = `code2prompt`;

	// Add options that match code2prompt's format
	if (options.outputFile) {
		cmd += ` -O "${options.outputFile}"`;
	}

	if (options.outputFormat && options.outputFormat !== 'markdown') {
		cmd += ` -F ${options.outputFormat}`;
	}

	// Add boolean flags
	const booleanFlags = {
		includePriority: '--include-priority',
		fullDirectoryTree: '--full-directory-tree',
		lineNumbers: '--line-numbers'
	};

	// Add each enabled boolean flag
	Object.entries(booleanFlags).forEach(([option, flag]) => {
		if (options[option]) cmd += ` ${flag}`;
	});

	// Add encoding option if present
	if (options.encoding) {
		cmd += ` -c ${options.encoding}`;
	}

	// Add exclude options - use a single -e flag with comma-separated patterns
	if (allExcludes.length > 0) {
		cmd += ` -e "${allExcludes.join(',')}"`;
	}

	// Add include options - use a single -i flag with comma-separated patterns
	if (options.include) {
		const includePatterns = options.include.split(',')
			.map(pattern => pattern.trim())
			.filter(pattern => pattern);

		if (includePatterns.length > 0) {
			cmd += ` -i "${includePatterns.join(',')}"`;
		}
	}

	// Add the directory path at the end
	cmd += ` "${options.directory}"`;

	return cmd;
}

// Execute the generated command
function executeCommand(cmd, execute) {
	if (execute) {
		utils.log.info('\nExecuting command...');
		try {
			execSync(cmd, { stdio: 'inherit' });
			utils.log.success('\nCommand executed successfully!');
		} catch (error) {
			utils.log.error('\nError executing command: ' + error.message);
		}
	}
}

// Process any unselected auto-excluded files
function processUnselectedAutoExcludes(autoExcluded, selectedExcludes) {
	const unselectedAutoExcludes = autoExcluded.filter(item => !selectedExcludes.includes(item));

	if (unselectedAutoExcludes.length > 0) {
		utils.log.warning(`You un-selected ${unselectedAutoExcludes.length} auto-excluded files that will be INCLUDED in the output:`);
		unselectedAutoExcludes.forEach(file => {
			utils.log.warning(`  + ${file}`);
		});
	}
}

// Display size information
function displaySizeInfo(size, limit, message) {
	const formattedSize = utils.formatSize(size);

	if (size > limit) {
		const exceedMessage = `(exceeds limit by ${utils.formatSize(size - limit)})`;
		utils.log.info(`\n${message}: ${formattedSize} ${chalk.red(exceedMessage)}`);
	} else {
		utils.log.info(`\n${message}: ${formattedSize} ${chalk.green('(within limit)')}`);
	}
}

// Main function
async function main() {
	try {
		// Set up command line options
		const options = setupCommandLine();

		utils.log.info(`Scanning directory "${options.directory}" for files...`);
		utils.log.warning('This may take a while for large codebases...');

		// Prepare exclude directories
		const skipDirs = getExcludeDirs(options);

		// Scan the directory
		const items = scanDirectory(options.directory, skipDirs);
		utils.log.success(`Found ${items.length} files and directories.`);

		// Prepare exclude patterns
		const { defaultExcludes, extraExcludes, allExcludes } = prepareExcludePatterns(options);

		// Calculate initial size with just default excludes
		const initialSize = estimateFinalSize(items, allExcludes);
		const sizeLimit = options.limit * 1024; // Convert KB to bytes

		utils.log.info(`\nSize limit: ${utils.formatSize(sizeLimit)} (${options.limit} KB)`);
		utils.log.info(`Estimated size with default excludes: ${utils.formatSize(initialSize)}`);

		if (initialSize > sizeLimit) {
			utils.log.warning(`\nWARNING: Current selection exceeds size limit by ${utils.formatSize(initialSize - sizeLimit)}`);
		}

		// Create choices for selection UI
		const { fileChoices, directoryChoices, allChoices } = createSelectionChoices(items, allExcludes);

		// Auto-exclude large files if needed and requested
		const autoExcluded = autoExcludeFiles(fileChoices, initialSize, sizeLimit, options.autoExclude);

		// Show selection UI
		const { selectedExcludes } = await inquirer.prompt([
			{
				type: 'checkbox',
				name: 'selectedExcludes',
				message: 'Select files/directories to EXCLUDE (sorted by size - Space to toggle, Enter to confirm):',
				choices: allChoices,
				pageSize: 20
			}
		]);

		utils.log.info(`\nFinal user selection: ${selectedExcludes.length} items`);

		// Process any unselected auto-excluded files
		processUnselectedAutoExcludes(autoExcluded, selectedExcludes);

		// The final list should contain default excludes plus user's selection
		const finalExcludes = [...defaultExcludes, ...extraExcludes, ...selectedExcludes];
		const finalSize = estimateFinalSize(items, finalExcludes);

		// Display final size information
		displaySizeInfo(finalSize, sizeLimit, "Final estimated size");

		// Combine default and selected excludes, removing duplicates
		const dedupedExcludes = Array.from(new Set(finalExcludes));

		// Create the code2prompt command
		const cmd = buildCommand(options, dedupedExcludes);

		console.log('\n' + chalk.green('Generated code2prompt command:'));
		console.log(chalk.yellow(cmd));

		// Execute the command if requested
		executeCommand(cmd, options.execute);

	} catch (error) {
		utils.log.error('Error: ' + error.message);
		process.exit(1);
	}
}

// Run the main function
main().catch(err => {
	utils.log.error('Error: ' + err.message);
	process.exit(1);
});