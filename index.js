#!/usr/bin/env node

const { program } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Package information
program
	.name('code2prompt-manager')
	.description('A CLI tool to manage code2prompt file size limits')
	.version('1.0.0');

// Command line options
program
	.option('-l, --limit <size>', 'Size limit for the generated MD file in KB', parseInt, 400)
	.option('-d, --directory <path>', 'Directory to scan', '.')
	.option('-e, --extra-exclude <patterns>', 'Additional exclude patterns (comma-separated)')
	.option('-i, --include <patterns>', 'Include patterns (comma-separated)')
	.option('-O, --output-file <file>', 'Output file name', 'codebase.md')
	.option('-F, --output-format <format>', 'Output format: markdown, json, or xml', 'markdown')
	.option('--include-priority', 'Include files in case of conflict between include and exclude patterns')
	.option('--full-directory-tree', 'List the full directory tree')
	.option('-c, --encoding <encoding>', 'Optional tokenizer to use for token count (cl100k, p50k, etc.)')
	.option('--line-numbers', 'Add line numbers to the source code')
	.option('-n, --no-execute', 'Only show the command, don\'t execute it');

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

		// Create choices for selection
		const choices = items.map(item => {
			const sizeStr = item.prettySize.padStart(10);
			const pathStr = item.path + (item.isDirectory ? '/' : '');

			return {
				name: `${sizeStr} │ ${pathStr}`,
				value: item.isDirectory ? `${item.path}/**` : item.path,
				short: item.path,
				checked: allDefaultExcludes.some(pattern => {
					// For directory patterns with '/**' - match pattern exactly 
					if (pattern.endsWith('/**')) {
						const dirName = pattern.slice(0, -3);

						// For top-level directories (e.g., "styles/**")
						if (!dirName.includes('/')) {
							// Match the exact directory or its direct children only
							return item.path === dirName ||
								(item.path.startsWith(dirName + '/') && !item.path.substring(dirName.length + 1).includes('/'));
						}
						// For path-specified directories (e.g., "components/annual-report-2022/styles/**")
						else {
							// Match the exact directory or its direct children only
							return item.path === dirName ||
								item.path.startsWith(dirName + '/');
						}
					}
					// For exact file matches (no wildcards)
					else if (!pattern.includes('*')) {
						return item.path === pattern;
					}
					// For other wildcard patterns
					else {
						const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
						return regex.test(item.path);
					}
				})
			};
		});

		// Show selection UI
		const { selectedExcludes } = await inquirer.prompt([
			{
				type: 'checkbox',
				name: 'selectedExcludes',
				message: 'Select files/directories to EXCLUDE (sorted by size - Space to toggle, Enter to confirm):',
				choices,
				pageSize: 20
			}
		]);

		// Combine default and selected excludes, removing duplicates
		const allExcludes = Array.from(new Set([...defaultExcludes, ...extraExcludes, ...selectedExcludes]));

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

		// Add exclude options
		if (allExcludes.length > 0) {
			allExcludes.forEach(pattern => {
				cmd += ` -e "${pattern}"`;
			});
		}

		// Add include options
		if (options.include) {
			options.include.split(',').forEach(pattern => {
				pattern = pattern.trim();
				if (pattern) {
					cmd += ` -i "${pattern}"`;
				}
			});
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