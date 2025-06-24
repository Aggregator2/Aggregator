const fs = require('fs');
const path = require('path');

// Read coverage summary
const coverageSummaryPath = path.join(__dirname, '../coverage/coverage-summary.json');

if (!fs.existsSync(coverageSummaryPath)) {
  console.error('Coverage summary not found. Run tests with coverage first.');
  process.exit(1);
}

const coverageSummary = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
const totalCoverage = coverageSummary.total;

// Calculate average coverage
const avgCoverage = (
  totalCoverage.lines.pct +
  totalCoverage.statements.pct +
  totalCoverage.functions.pct +
  totalCoverage.branches.pct
) / 4;

// Determine badge color
let color;
if (avgCoverage >= 80) {
  color = 'brightgreen';
} else if (avgCoverage >= 60) {
  color = 'yellow';
} else if (avgCoverage >= 40) {
  color = 'orange';
} else {
  color = 'red';
}

// Generate coverage report
const report = `
# Coverage Report

Generated on: ${new Date().toISOString()}

## Summary
- **Lines**: ${totalCoverage.lines.pct}% (${totalCoverage.lines.covered}/${totalCoverage.lines.total})
- **Statements**: ${totalCoverage.statements.pct}% (${totalCoverage.statements.covered}/${totalCoverage.statements.total})
- **Functions**: ${totalCoverage.functions.pct}% (${totalCoverage.functions.covered}/${totalCoverage.functions.total})
- **Branches**: ${totalCoverage.branches.pct}% (${totalCoverage.branches.covered}/${totalCoverage.branches.total})

**Average Coverage**: ${avgCoverage.toFixed(2)}%

## Badge
![Coverage](https://img.shields.io/badge/coverage-${avgCoverage.toFixed(1)}%25-${color})

## Detailed Report
See the full HTML report in \`coverage/index.html\`
`;

// Write report
fs.writeFileSync(path.join(__dirname, '../coverage-report.md'), report);

// Update README badge if it exists
const readmePath = path.join(__dirname, '../README.md');
if (fs.existsSync(readmePath)) {
  let readme = fs.readFileSync(readmePath, 'utf8');
  
  // Update coverage badge
  const badgeRegex = /!\[Coverage\]\(https:\/\/img\.shields\.io\/badge\/coverage-[\d.]+%25-\w+\)/;
  const newBadge = `![Coverage](https://img.shields.io/badge/coverage-${avgCoverage.toFixed(1)}%25-${color})`;
  
  if (badgeRegex.test(readme)) {
    readme = readme.replace(badgeRegex, newBadge);
  } else {
    // Add badge after title if not present
    readme = readme.replace(/^(# .+\n)/, `$1\n${newBadge}\n`);
  }
  
  fs.writeFileSync(readmePath, readme);
}

console.log(`Coverage: ${avgCoverage.toFixed(2)}% (${color})`);
console.log('Coverage report generated successfully!');