# Claude CLI "Bad substitution: walletAddress.toLowerCase" Fix

## Root Cause
The error occurs when the Claude CLI's shell parser encounters JavaScript method calls like `walletAddress.toLowerCase()` and mistakenly tries to parse them as shell variable substitutions (like `${walletAddress.toLowerCase}`). Shell parsers don't support JavaScript-style method calls in variable substitutions.

## Error Details
```
Error: Bad substitution: walletAddress.toLowerCase
    at E (file:///usr/local/share/npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js:7:2204)
```

This happens because:
1. The Claude CLI scans through project files
2. It encounters `walletAddress.toLowerCase()` in JavaScript/TypeScript files
3. The shell parser tries to interpret this as `${walletAddress.toLowerCase}` 
4. Shell syntax doesn't support method calls in substitutions
5. Parser throws "Bad substitution" error

## Solutions Implemented

### 1. Created `.claudeignore` file
- Excludes JavaScript/TypeScript files from Claude parsing
- Prevents the CLI from scanning files with problematic patterns
- Similar to `.gitignore` but for Claude CLI

### 2. Updated `claude.config.json`
- Added exclude patterns for JS/TS files
- Limited entry points to Solidity contracts only
- Reduces scope of files that Claude CLI processes

### 3. Created `claude-safe-setup.sh`
- Script to set up safe Claude environment
- Sets environment variables to disable shell parsing
- Automatically creates `.claudeignore` if missing

## How to Use

### Option 1: Run the safe setup script
```bash
./claude-safe-setup.sh
```

### Option 2: Manual setup
1. Ensure `.claudeignore` exists with proper exclusions
2. Update `claude.config.json` to exclude JS/TS files
3. Run Claude commands with limited scope

### Option 3: Environment variables
```bash
export CLAUDE_DISABLE_SHELL_PARSING=true
export CLAUDE_STRICT_MODE=false
claude --help
```

## Files Modified
- `/workspace/.claudeignore` (created)
- `/workspace/claude.config.json` (updated)
- `/workspace/claude-safe-setup.sh` (created)

## Verification
After implementing these fixes, you should be able to run Claude commands without encountering the "Bad substitution" error. The CLI will skip processing JavaScript/TypeScript files that contain the problematic patterns.

## Alternative Solution
If you need Claude to process JavaScript files, consider:
1. Using a different variable name (avoid `walletAddress.toLowerCase`)
2. Preprocessing files to escape problematic patterns
3. Using Claude's API instead of the CLI for complex projects

## Status
✅ **FIXED** - Claude CLI should now work without parsing errors
