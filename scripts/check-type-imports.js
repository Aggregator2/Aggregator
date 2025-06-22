#!/usr/bin/env node

/**
 * Script to check for missing or incorrect type imports in TypeScript/React files
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Define the types that should be imported from specific locations
const TYPE_IMPORT_RULES = {
  // Types that should come from types/wallet.ts
  'types/wallet': ['Order', 'Quote', 'Token', 'WalletState', 'SwapFormState', 'ApiResponse'],
  
  // Types that should come from src/types/token.ts
  'src/types/token': ['TokenType', 'TokenList', 'TokenBalance', 'ChainConfig'],
  
  // Types that can come from either (Token is in both)
  'either': ['Token']
};

// Files to check
const PATTERNS = [
  'components/**/*.{ts,tsx}',
  'pages/**/*.{ts,tsx}',
  'src/services/**/*.{ts,tsx}',
  'hooks/**/*.{ts,tsx}',
  'utils/**/*.{ts,tsx}'
];

// Files to exclude
const EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  '**/types/**' // Don't check type definition files themselves
];

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const issues = [];
  
  // Check for 'any' types that could be replaced
  const anyTypeRegex = /:\s*any\b/g;
  const anyMatches = content.match(anyTypeRegex);
  if (anyMatches) {
    anyMatches.forEach(match => {
      // Check if it's a Quote, Order, or Token that should be typed
      const context = content.substring(content.indexOf(match) - 50, content.indexOf(match) + 50);
      if (context.match(/quote|order|token/i)) {
        issues.push({
          type: 'any-type',
          message: `Found 'any' type that might need proper typing: ${match}`,
          context: context.trim()
        });
      }
    });
  }
  
  // Check for types used without imports
  Object.entries(TYPE_IMPORT_RULES).forEach(([source, types]) => {
    if (source === 'either') return; // Skip 'either' category
    
    types.forEach(type => {
      // Check if type is used
      const typeUsageRegex = new RegExp(`\\b${type}\\b(?!['"])`, 'g');
      const usages = content.match(typeUsageRegex);
      
      if (usages && usages.length > 0) {
        // Check if it's imported
        const importRegex = new RegExp(`import.*\\b${type}\\b.*from\\s+['"].*${source.replace('/', '\\/')}['"]`);
        const hasImport = importRegex.test(content);
        
        if (!hasImport) {
          // Check if it's imported from somewhere else
          const anyImportRegex = new RegExp(`import.*\\b${type}\\b.*from`);
          const hasAnyImport = anyImportRegex.test(content);
          
          if (!hasAnyImport) {
            issues.push({
              type: 'missing-import',
              message: `Type '${type}' is used but not imported`,
              suggestion: `Add: import type { ${type} } from '../${source}';`
            });
          } else if (!TYPE_IMPORT_RULES.either.includes(type)) {
            // It's imported from wrong location
            const wrongImportMatch = content.match(new RegExp(`import.*\\b${type}\\b.*from\\s+['"]([^'"]+)['"]`));
            if (wrongImportMatch) {
              issues.push({
                type: 'wrong-import',
                message: `Type '${type}' is imported from wrong location: ${wrongImportMatch[1]}`,
                suggestion: `Should import from: ${source}`
              });
            }
          }
        }
      }
    });
  });
  
  // Check for inline type definitions that should use imported types
  const inlineOrderRegex = /\{\s*id:\s*string;\s*status:\s*['"]?(pending|filled|failed)['"]?/;
  if (inlineOrderRegex.test(content)) {
    issues.push({
      type: 'inline-type',
      message: 'Found inline Order-like type definition',
      suggestion: 'Consider using the Order type from types/wallet.ts'
    });
  }
  
  return issues;
}

function main() {
  console.log('🔍 Checking TypeScript type imports...\n');
  
  const allIssues = [];
  
  PATTERNS.forEach(pattern => {
    const files = glob.sync(pattern, { 
      ignore: EXCLUDE_PATTERNS,
      cwd: process.cwd() 
    });
    
    files.forEach(file => {
      const issues = checkFile(file);
      if (issues.length > 0) {
        allIssues.push({ file, issues });
      }
    });
  });
  
  if (allIssues.length === 0) {
    console.log('✅ No type import issues found!');
  } else {
    console.log(`❌ Found ${allIssues.length} files with type import issues:\n`);
    
    allIssues.forEach(({ file, issues }) => {
      console.log(`📄 ${file}`);
      issues.forEach(issue => {
        console.log(`   ${issue.type === 'any-type' ? '⚠️' : '❌'} ${issue.message}`);
        if (issue.suggestion) {
          console.log(`      💡 ${issue.suggestion}`);
        }
        if (issue.context) {
          console.log(`      📝 Context: ${issue.context}`);
        }
      });
      console.log('');
    });
    
    // Summary
    const totalIssues = allIssues.reduce((sum, { issues }) => sum + issues.length, 0);
    console.log(`\n📊 Summary: ${totalIssues} issues in ${allIssues.length} files`);
    
    const issueTypes = {};
    allIssues.forEach(({ issues }) => {
      issues.forEach(issue => {
        issueTypes[issue.type] = (issueTypes[issue.type] || 0) + 1;
      });
    });
    
    console.log('\nIssue breakdown:');
    Object.entries(issueTypes).forEach(([type, count]) => {
      console.log(`  - ${type}: ${count}`);
    });
  }
}

// Run the script
try {
  main();
} catch (error) {
  console.error('❌ Error running type import check:', error);
  process.exit(1);
}