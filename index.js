#!/usr/bin/env node

const { program } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const packageJson = require('./package.json');

// Get the current directory name for default output file
const getCurrentDirectoryName = () => {
	const currentPath = process.cwd();
	return path.basename(currentPath) + '.md';
};

// Package information
program
	.name('code2prompt-manager')
	.description('A CLI tool to manage code2prompt file size limits')
	.version(packageJson.version);

// Command line options
program
	.option('-l, --limit <size>', 'Size limit for the generated MD file in KB', (value) => parseInt(value, 10), 400)
	.option('-d, --directory <path>', 'Directory to scan', '.')
	.option('-e, --extra-exclude <patterns>', 'Additional exclude patterns (comma-separated)')
	.option('-i, --include <patterns>', 'Include patterns (comma-separated)')
	.option('-O, --output-file <file>', 'Output file name', getCurrentDirectoryName())
	.option('-F, --output-format <format>', 'Output format: markdown, json, or xml', 'markdown')
	.option('--include-priority', 'Include files in case of conflict between include and exclude patterns')
	.option('--full-directory-tree', 'List the full directory tree')
	.option('-c, --encoding <encoding>', 'Optional tokenizer to use for token count (cl100k, p50k, etc.)')
	.option('--line-numbers', 'Add line numbers to the source code')
	.option('-n, --no-execute', 'Only show the command, don\'t execute it')
	.option('--auto-exclude', 'Automatically exclude files to stay under size limit', false);

program.parse(process.argv);
const options = program.opts();

// Utility function to format file sizes
function formatSize(bytes) {
	const units = ['B', 'KB', 'MB', 'GB'];
	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// Get files and directories recursively
function scanDirectory(rootDir) {
	const items = [];
	// Default directories to skip during scanning
	const skipDirs = ['node_modules', '.git', 'vendor', '.next', 'dist', 'build', '.husky', 'public', 'docs'];

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
								prettySize: formatSize(0)
							});
							continue;
						}

						// Add the directory
						items.push({
							path: relativePath,
							isDirectory: true,
							size: getDirSize(fullPath),
							prettySize: formatSize(getDirSize(fullPath))
						});

						// Scan subdirectory
						scan(fullPath, relativePath);
					} else {
						// Add the file
						items.push({
							path: relativePath,
							isDirectory: false,
							size: stats.size,
							prettySize: formatSize(stats.size)
						});
					}
				} catch (err) {
					console.warn(chalk.yellow(`Warning: Could not access ${fullPath}: ${err.message}`));
				}
			}
		} catch (err) {
			console.warn(chalk.yellow(`Warning: Could not read directory ${dir}: ${err.message}`));
		}
	}

	// Calculate directory size
	function getDirSize(dirPath) {
		let totalSize = 0;

		try {
			const entries = fs.readdirSync(dirPath);

			for (const entry of entries) {
				const entryPath = path.join(dirPath, entry);

				try {
					const stats = fs.statSync(entryPath);

					if (stats.isDirectory()) {
						totalSize += getDirSize(entryPath);
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
	}

	// Start scanning from the root directory
	scan(rootDir);

	// Sort items by size (largest first)
	return items.sort((a, b) => b.size - a.size);
}

// Estimate the final size after excluding files
function estimateFinalSize(items, excludePatterns) {
	let totalSize = 0;

	// Helper function to check if a file/directory is excluded
	function isExcluded(itemPath, isDirectory) {
		const itemPathWithWildcard = isDirectory ? `${itemPath}/**` : itemPath;

		return excludePatterns.some(pattern => {
			// For directory patterns with '/**' - match pattern exactly 
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
		});
	}

	// Sum sizes of all files that are not excluded
	items.forEach(item => {
		if (!item.isDirectory && !isExcluded(item.path, item.isDirectory)) {
			totalSize += item.size;
		}
	});

	// Add some overhead for markdown formatting
	const markdownOverhead = Math.min(items.length * 100, 50 * 1024); // ~100 bytes per file, max 50KB

	return totalSize + markdownOverhead;
}

// Main function
async function main() {
	try {
		console.log(chalk.blue(`Scanning directory "${options.directory}" for files...`));
		console.log(chalk.yellow('This may take a while for large codebases...'));

		// Scan the directory
		const items = scanDirectory(options.directory);

		console.log(chalk.green(`Found ${items.length} files and directories.`));

		// Default excludes
		const defaultExcludes = [
			'node_modules/**',
			'vendor/**',
			'.git/**',
			'.next/**',
			'.husky/**',
			'dist/**',
			'build/**',
			'public/**',
			'docs/**',
			'package-lock.json',
			'composer.lock',
			'yarn.lock',
			'*.min.js',
			'*.min.css'
		];

		// Add extra exclude patterns from command line to defaultExcludes
		const extraExcludes = [];
		if (options.extraExclude) {
			options.extraExclude.split(',').forEach(pattern => {
				pattern = pattern.trim();
				if (pattern) {
					// Add '/**' suffix for directory patterns that don't have wildcards
					if (!pattern.includes('*') && fs.existsSync(path.join(options.directory, pattern)) &&
						fs.statSync(path.join(options.directory, pattern)).isDirectory()) {
						extraExcludes.push(pattern + '/**');
					} else {
						extraExcludes.push(pattern);
					}
				}
			});
		}

		// Combine defaults with extras
		const allDefaultExcludes = [...defaultExcludes, ...extraExcludes];

		// Calculate initial size with just default excludes
		const initialSize = estimateFinalSize(items, allDefaultExcludes);
		const sizeLimit = options.limit * 1024; // Convert KB to bytes

		console.log(chalk.blue(`\nSize limit: ${formatSize(sizeLimit)} (${options.limit} KB)`));
		console.log(chalk.blue(`Estimated size with default excludes: ${formatSize(initialSize)}`));

		if (initialSize > sizeLimit) {
			console.log(chalk.yellow(`\nWARNING: Current selection exceeds size limit by ${formatSize(initialSize - sizeLimit)}`));
		}

		// Create choices for selection and sort by size (largest first)
		const choices = items
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
					checked: allDefaultExcludes.some(pattern => {
						// For exact file matches (no wildcards)
						if (!pattern.includes('*')) {
							return item.path === pattern;
						}
						// For wildcard patterns
						else {
							const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
							return regex.test(item.path);
						}
					})
				};
			});

		// Add directories as separate section
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
					checked: allDefaultExcludes.some(pattern => {
						// For directory patterns with '/**' - match pattern exactly 
						if (pattern.endsWith('/**')) {
							const dirName = pattern.slice(0, -3);

							// For top-level directories (e.g., "styles/**")
							if (!dirName.includes('/')) {
								return item.path === dirName ||
									(item.path.startsWith(dirName + '/') && !item.path.substring(dirName.length + 1).includes('/'));
							}
							// For path-specified directories
							else {
								return item.path === dirName ||
									item.path.startsWith(dirName + '/');
							}
						}
						// For other patterns
						else {
							const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
							return regex.test(item.path);
						}
					})
				};
			});

		// Auto-exclude large files if needed and requested
		let autoExcluded = [];
		if (options.autoExclude && initialSize > sizeLimit) {
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
				console.log(chalk.yellow(`\nAuto-excluded ${autoExcluded.length} files to meet size limit:`));
				autoExcluded.forEach(file => {
					console.log(chalk.yellow(`  - ${file}`));
				});
				console.log(chalk.green(`New estimated size: ${formatSize(remainingSize)}`));
			}
		}

		// Combine file and directory choices for the selection UI
		const allChoices = [
			new inquirer.Separator(' === Files (sorted by size) === '),
			...choices,
			new inquirer.Separator(' === Directories === '),
			...directoryChoices
		];

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

		// For auto-excluded files, we should ONLY consider them if they are still in the selectedExcludes
		// This is the correct approach - the user's final selection is the source of truth

		console.log(chalk.blue(`\nFinal user selection: ${selectedExcludes.length} items`));

		// Log any auto-excluded files that were unselected by the user
		const unselectedAutoExcludes = autoExcluded.filter(item => !selectedExcludes.includes(item));
		if (unselectedAutoExcludes.length > 0) {
			console.log(chalk.yellow(`You un-selected ${unselectedAutoExcludes.length} auto-excluded files that will be INCLUDED in the output:`));
			unselectedAutoExcludes.forEach(file => {
				console.log(chalk.yellow(`  + ${file}`));
			});
		}

		// The final list should ONLY contain what's in the user's selection plus default excludes
		const finalExcludes = [...defaultExcludes, ...extraExcludes, ...selectedExcludes];
		const finalSize = estimateFinalSize(items, finalExcludes);

		console.log(chalk.blue(`\nFinal estimated size: ${formatSize(finalSize)} ${finalSize > sizeLimit ? chalk.red(`(exceeds limit by ${formatSize(finalSize - sizeLimit)})`) : chalk.green('(within limit)')}`));

		// Combine default and selected excludes, removing duplicates
		const allExcludes = Array.from(new Set(finalExcludes));

		// Create the code2prompt command
		let cmd = `code2prompt`;

		// Add options that match code2prompt's format
		if (options.outputFile) {
			cmd += ` -O "${options.outputFile}"`;
		}

		if (options.outputFormat && options.outputFormat !== 'markdown') {
			cmd += ` -F ${options.outputFormat}`;
		}

		if (options.includePriority) {
			cmd += ` --include-priority`;
		}

		if (options.fullDirectoryTree) {
			cmd += ` --full-directory-tree`;
		}

		if (options.encoding) {
			cmd += ` -c ${options.encoding}`;
		}

		if (options.lineNumbers) {
			cmd += ` --line-numbers`;
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

		console.log('\n' + chalk.green('Generated code2prompt command:'));
		console.log(chalk.yellow(cmd));

		// Execute the command if requested
		if (options.execute) {
			console.log(chalk.blue('\nExecuting command...'));
			try {
				execSync(cmd, { stdio: 'inherit' });
				console.log(chalk.green('\nCommand executed successfully!'));
			} catch (error) {
				console.error(chalk.red('\nError executing command:'), error.message);
			}
		}

	} catch (error) {
		console.error(chalk.red('Error:'), error.message);
		process.exit(1);
	}
}

// Run the main function
main().catch(err => {
	console.error(chalk.red('Error:'), err.message);
	process.exit(1);
});