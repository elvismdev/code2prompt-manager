# Code2Prompt Manager

A CLI tool to manage file size limits when using [code2prompt](https://github.com/mufeedvh/code2prompt). This tool helps you interactively select which files to exclude from your codebase to keep the output Markdown file under your desired size limit.

## Installation

```bash
# Install globally
npm install -g code2prompt-manager

# Or run directly with npx
npx code2prompt-manager
```

## Prerequisites

- Node.js 12 or higher
- code2prompt must already be installed on your system

## Usage

```bash
code2prompt-manager [options]
```

### Options

- `-l, --limit <size>`: Size limit for the generated MD file in KB (default: 400)
- `-d, --directory <path>`: Directory to scan (default: current directory)
- `-e, --extra-exclude <patterns>`: Additional exclude patterns (comma-separated)
- `-i, --include <patterns>`: Include patterns (comma-separated)
- `-O, --output-file <file>`: Output file name (default: current directory name + .md)
- `-F, --output-format <format>`: Output format: markdown, json, or xml (default: markdown)
- `--include-priority`: Include files in case of conflict between include and exclude patterns
- `--full-directory-tree`: List the full directory tree
- `-c, --encoding <encoding>`: Optional tokenizer to use for token count
- `--line-numbers`: Add line numbers to the source code
- `-n, --no-execute`: Only show the command, don't execute it
- `--auto-exclude`: Automatically exclude files to stay under size limit

## How it Works

1. The tool scans your codebase directory
2. Files and directories are sorted by size (largest first)
3. When using `--auto-exclude`, the tool automatically selects large files to exclude to meet the size limit
4. An interactive UI lets you select which files to exclude or include
5. The tool calculates the estimated output file size based on your selections
6. The tool generates and executes the appropriate code2prompt command

## Example

```bash
# Basic usage with default options
code2prompt-manager

# Set a custom size limit (in KB)
code2prompt-manager --limit 350

# Automatically exclude large files to stay under the limit
code2prompt-manager --limit 350 --auto-exclude

# Specify a custom output file
code2prompt-manager --output-file my-project.md

# Scan a specific directory and don't execute the command
code2prompt-manager -d ./my-project -n

# Specify additional files to exclude
code2prompt-manager -e "*.log,temp/**"
```

## Default Excludes

The tool automatically excludes common large directories and files:

- node_modules/**
- vendor/**
- .git/**
- .next/**
- .husky/**
- dist/**
- build/**
- public/**
- docs/**
- package-lock.json
- composer.lock
- yarn.lock
- *.min.js
- *.min.css

You can add or remove excludes through the interactive selection.

## Size Limit Enforcement

The `-l, --limit` option sets a target size limit for your output file:

- The tool will show you the estimated output size based on your selections
- If you're over the limit, it will warn you with color-coded indicators
- Use `--auto-exclude` to have the tool automatically exclude the largest files to meet your limit
- You can still manually adjust the selection after auto-exclude

## Tips for Reducing File Size

1. Exclude test files and directories
2. Exclude documentation and example files
3. Exclude large media files
4. Focus on the core functionality of your codebase
5. Exclude third-party libraries and dependencies

## License

MIT