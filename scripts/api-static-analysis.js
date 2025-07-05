#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const { promisify } = require('util');
const globAsync = promisify(glob);

// Color codes for output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// Analysis results
const analysisResults = {
  fullyImplemented: [],
  partiallyImplemented: [],
  missingOrBroken: []
};

// Check if file contains authentication logic
async function hasAuthentication(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const authPatterns = [
      /x-api-key/i,
      /authorization/i,
      /authenticate/i,
      /requireAuth/i,
      /withAuth/i,
      /apiKeyAuth/i,
      /verifyToken/i,
      /checkAuth/i,
      /isAuthenticated/i
    ];
    
    return authPatterns.some(pattern => pattern.test(content));
  } catch (error) {
    return false;
  }
}

// Check if file has input validation
async function hasValidation(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const validationPatterns = [
      /validate/i,
      /schema\./,
      /joi\./,
      /yup\./,
      /zod\./,
      /\.isEmail/,
      /\.isLength/,
      /\.isEmpty/,
      /check\(/,
      /body\(/,
      /query\(/,
      /param\(/,
      /validationResult/,
      /BadRequest/,
      /status\(400\)/
    ];
    
    return validationPatterns.some(pattern => pattern.test(content));
  } catch (error) {
    return false;
  }
}

// Check if file has error handling
async function hasErrorHandling(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const errorPatterns = [
      /try\s*{/,
      /catch\s*\(/,
      /\.catch\(/,
      /error/i,
      /exception/i,
      /status\(500\)/,
      /status\(4\d{2}\)/,
      /res\.status/,
      /next\(.*err/
    ];
    
    return errorPatterns.some(pattern => pattern.test(content));
  } catch (error) {
    return false;
  }
}

// Check for security issues
async function checkSecurity(filePath) {
  const issues = [];
  try {
    const content = await fs.readFile(filePath, 'utf8');
    
    // SQL Injection patterns
    const sqlPatterns = [
      /query\s*\+\s*['"]/,
      /query.*\$\{/,
      /query.*\+.*req\./,
      /WHERE.*\+.*req\./i,
      /exec\(/,
      /eval\(/
    ];
    
    if (sqlPatterns.some(pattern => pattern.test(content))) {
      issues.push('Potential SQL injection vulnerability');
    }
    
    // XSS patterns
    const xssPatterns = [
      /innerHTML\s*=/,
      /document\.write/,
      /res\.send\(.*req\./,
      /res\.json\(.*req\./
    ];
    
    if (xssPatterns.some(pattern => pattern.test(content)) && 
        !content.includes('sanitize') && 
        !content.includes('escape')) {
      issues.push('Potential XSS vulnerability');
    }
    
    // Rate limiting check
    if (!content.includes('rateLimit') && 
        !content.includes('rate-limit') && 
        !content.includes('throttle')) {
      issues.push('No rate limiting detected');
    }
    
    // CORS check
    if (content.includes('*') && content.includes('Access-Control-Allow-Origin')) {
      issues.push('Overly permissive CORS configuration');
    }
    
  } catch (error) {
    issues.push('Unable to analyze file');
  }
  
  return issues;
}

// Get HTTP method from file
async function getHttpMethod(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    
    // Check for explicit method exports
    if (/export\s+(?:default\s+)?async\s+function\s+handler/i.test(content)) {
      if (/req\.method\s*===?\s*['"]GET['"]/i.test(content)) return 'GET';
      if (/req\.method\s*===?\s*['"]POST['"]/i.test(content)) return 'POST';
      if (/req\.method\s*===?\s*['"]PUT['"]/i.test(content)) return 'PUT';
      if (/req\.method\s*===?\s*['"]DELETE['"]/i.test(content)) return 'DELETE';
      if (/req\.method\s*===?\s*['"]PATCH['"]/i.test(content)) return 'PATCH';
    }
    
    // Check for method-specific exports
    if (/export\s+(?:async\s+)?function\s+GET/i.test(content)) return 'GET';
    if (/export\s+(?:async\s+)?function\s+POST/i.test(content)) return 'POST';
    if (/export\s+(?:async\s+)?function\s+PUT/i.test(content)) return 'PUT';
    if (/export\s+(?:async\s+)?function\s+DELETE/i.test(content)) return 'DELETE';
    if (/export\s+(?:async\s+)?function\s+PATCH/i.test(content)) return 'PATCH';
    
    // Default based on common patterns
    if (/create|submit|add|insert/i.test(filePath)) return 'POST';
    if (/update|edit|modify/i.test(filePath)) return 'PUT/PATCH';
    if (/delete|remove|cancel/i.test(filePath)) return 'DELETE';
    
    return 'GET';
  } catch (error) {
    return 'UNKNOWN';
  }
}

// Analyze a single endpoint file
async function analyzeEndpoint(filePath) {
  const apiPath = filePath
    .replace(/^.*\/pages\/api/, '/api')
    .replace(/\.(js|ts)$/, '')
    .replace(/\/index$/, '')
    .replace(/\[([^\]]+)\]/g, ':$1');
  
  const result = {
    endpoint: apiPath,
    filePath,
    method: await getHttpMethod(filePath),
    hasAuth: await hasAuthentication(filePath),
    hasValidation: await hasValidation(filePath),
    hasErrorHandling: await hasErrorHandling(filePath),
    securityIssues: await checkSecurity(filePath),
    fileSize: 0,
    lastModified: null
  };
  
  // Get file stats
  try {
    const stats = await fs.stat(filePath);
    result.fileSize = stats.size;
    result.lastModified = stats.mtime;
  } catch (error) {
    // Ignore stat errors
  }
  
  // Check if it's a WebSocket endpoint
  if (filePath.includes('websocket') || filePath.includes('/ws/')) {
    result.isWebSocket = true;
  }
  
  // Categorize the result
  const hasIssues = !result.hasAuth || !result.hasValidation || 
                   !result.hasErrorHandling || result.securityIssues.length > 0;
  
  if (!hasIssues) {
    analysisResults.fullyImplemented.push(result);
  } else if (result.hasErrorHandling && (result.hasAuth || result.hasValidation)) {
    analysisResults.partiallyImplemented.push(result);
  } else {
    analysisResults.missingOrBroken.push(result);
  }
  
  return result;
}

// Main analysis function
async function runAnalysis() {
  console.log(`${colors.blue}SwappiQ API Static Analysis${colors.reset}`);
  console.log(`${colors.blue}===========================${colors.reset}\n`);
  
  // Find all API files
  const apiFiles = await globAsync('/workspace/pages/api/**/*.{js,ts}', {
    ignore: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts']
  });
  
  console.log(`Found ${apiFiles.length} API endpoint files\n`);
  
  // Analyze each file
  for (const file of apiFiles) {
    process.stdout.write(`Analyzing ${file.replace('/workspace/pages', '')}...`);
    const result = await analyzeEndpoint(file);
    
    if (analysisResults.fullyImplemented.includes(result)) {
      console.log(` ${colors.green}✅${colors.reset}`);
    } else if (analysisResults.partiallyImplemented.includes(result)) {
      console.log(` ${colors.yellow}⚠️${colors.reset}`);
    } else {
      console.log(` ${colors.red}❌${colors.reset}`);
    }
  }
  
  // Generate report
  const report = {
    summary: {
      totalEndpoints: apiFiles.length,
      fullyImplemented: analysisResults.fullyImplemented.length,
      partiallyImplemented: analysisResults.partiallyImplemented.length,
      missingOrBroken: analysisResults.missingOrBroken.length,
      timestamp: new Date().toISOString()
    },
    endpoints: {
      fullyImplemented: analysisResults.fullyImplemented.map(e => ({
        endpoint: e.endpoint,
        method: e.method,
        fileSize: `${(e.fileSize / 1024).toFixed(2)} KB`,
        lastModified: e.lastModified
      })),
      partiallyImplemented: analysisResults.partiallyImplemented.map(e => ({
        endpoint: e.endpoint,
        method: e.method,
        issues: {
          missingAuth: !e.hasAuth,
          missingValidation: !e.hasValidation,
          missingErrorHandling: !e.hasErrorHandling,
          security: e.securityIssues
        }
      })),
      missingOrBroken: analysisResults.missingOrBroken.map(e => ({
        endpoint: e.endpoint,
        method: e.method,
        issues: {
          missingAuth: !e.hasAuth,
          missingValidation: !e.hasValidation,
          missingErrorHandling: !e.hasErrorHandling,
          security: e.securityIssues
        }
      }))
    },
    securitySummary: {
      endpointsWithoutAuth: analysisResults.partiallyImplemented
        .concat(analysisResults.missingOrBroken)
        .filter(e => !e.hasAuth).length,
      endpointsWithoutValidation: analysisResults.partiallyImplemented
        .concat(analysisResults.missingOrBroken)
        .filter(e => !e.hasValidation).length,
      endpointsWithSecurityIssues: analysisResults.partiallyImplemented
        .concat(analysisResults.missingOrBroken)
        .filter(e => e.securityIssues.length > 0).length
    }
  };
  
  // Print summary
  console.log(`\n${colors.blue}Analysis Summary${colors.reset}`);
  console.log(`${colors.blue}================${colors.reset}\n`);
  console.log(`${colors.green}✅ Fully Implemented: ${report.summary.fullyImplemented}${colors.reset}`);
  console.log(`${colors.yellow}⚠️  Partially Implemented: ${report.summary.partiallyImplemented}${colors.reset}`);
  console.log(`${colors.red}❌ Missing or Broken: ${report.summary.missingOrBroken}${colors.reset}\n`);
  
  console.log(`${colors.blue}Security Summary${colors.reset}`);
  console.log(`${colors.blue}================${colors.reset}`);
  console.log(`Endpoints without authentication: ${report.securitySummary.endpointsWithoutAuth}`);
  console.log(`Endpoints without validation: ${report.securitySummary.endpointsWithoutValidation}`);
  console.log(`Endpoints with security issues: ${report.securitySummary.endpointsWithSecurityIssues}\n`);
  
  // Save reports
  const jsonPath = '/workspace/api-static-analysis-report.json';
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  console.log(`Detailed JSON report saved to: ${jsonPath}`);
  
  // Generate and save markdown report
  const markdownReport = generateMarkdownReport(report);
  const mdPath = '/workspace/API_STATIC_ANALYSIS_REPORT.md';
  await fs.writeFile(mdPath, markdownReport);
  console.log(`Markdown report saved to: ${mdPath}`);
}

// Generate markdown report
function generateMarkdownReport(report) {
  let md = `# SwappiQ API Static Analysis Report\n\n`;
  md += `Generated: ${report.summary.timestamp}\n\n`;
  
  md += `## Summary\n\n`;
  md += `- **Total Endpoints**: ${report.summary.totalEndpoints}\n`;
  md += `- **✅ Fully Implemented**: ${report.summary.fullyImplemented}\n`;
  md += `- **⚠️  Partially Implemented**: ${report.summary.partiallyImplemented}\n`;
  md += `- **❌ Missing Security Features**: ${report.summary.missingOrBroken}\n\n`;
  
  md += `## Security Summary\n\n`;
  md += `- **Endpoints without authentication**: ${report.securitySummary.endpointsWithoutAuth}\n`;
  md += `- **Endpoints without validation**: ${report.securitySummary.endpointsWithoutValidation}\n`;
  md += `- **Endpoints with security issues**: ${report.securitySummary.endpointsWithSecurityIssues}\n\n`;
  
  md += `## Fully Implemented Endpoints (${report.endpoints.fullyImplemented.length})\n\n`;
  if (report.endpoints.fullyImplemented.length > 0) {
    md += `| Endpoint | Method | File Size | Last Modified |\n`;
    md += `|----------|--------|-----------|---------------|\n`;
    report.endpoints.fullyImplemented.forEach(e => {
      md += `| ${e.endpoint} | ${e.method} | ${e.fileSize} | ${new Date(e.lastModified).toLocaleDateString()} |\n`;
    });
  }
  
  md += `\n## Partially Implemented Endpoints (${report.endpoints.partiallyImplemented.length})\n\n`;
  if (report.endpoints.partiallyImplemented.length > 0) {
    report.endpoints.partiallyImplemented.forEach(e => {
      md += `### ${e.endpoint} (${e.method})\n\n`;
      md += `**Issues:**\n`;
      if (e.issues.missingAuth) md += `- Missing authentication\n`;
      if (e.issues.missingValidation) md += `- Missing input validation\n`;
      if (e.issues.missingErrorHandling) md += `- Missing error handling\n`;
      if (e.issues.security.length > 0) {
        md += `- Security issues: ${e.issues.security.join(', ')}\n`;
      }
      md += `\n`;
    });
  }
  
  md += `## Endpoints Missing Security Features (${report.endpoints.missingOrBroken.length})\n\n`;
  if (report.endpoints.missingOrBroken.length > 0) {
    report.endpoints.missingOrBroken.forEach(e => {
      md += `### ${e.endpoint} (${e.method})\n\n`;
      md += `**Issues:**\n`;
      if (e.issues.missingAuth) md += `- Missing authentication\n`;
      if (e.issues.missingValidation) md += `- Missing input validation\n`;
      if (e.issues.missingErrorHandling) md += `- Missing error handling\n`;
      if (e.issues.security.length > 0) {
        md += `- Security issues: ${e.issues.security.join(', ')}\n`;
      }
      md += `\n`;
    });
  }
  
  md += `## Recommendations\n\n`;
  md += `### 🔴 Critical Security Issues\n\n`;
  md += `1. **Implement Authentication**: Add API key or JWT authentication to all sensitive endpoints\n`;
  md += `2. **Add Input Validation**: Use a validation library (Joi, Yup, Zod) to validate all user inputs\n`;
  md += `3. **Implement Rate Limiting**: Add rate limiting middleware to prevent abuse\n`;
  md += `4. **Fix SQL Injection Vulnerabilities**: Use parameterized queries or an ORM\n\n`;
  
  md += `### 🟠 High Priority\n\n`;
  md += `1. **Error Handling**: Implement consistent error handling across all endpoints\n`;
  md += `2. **CORS Configuration**: Review and restrict CORS policies\n`;
  md += `3. **Security Headers**: Add security headers (CSP, X-Frame-Options, etc.)\n\n`;
  
  md += `### 🟡 Medium Priority\n\n`;
  md += `1. **API Documentation**: Generate OpenAPI/Swagger documentation\n`;
  md += `2. **Request Logging**: Implement comprehensive request logging\n`;
  md += `3. **Health Monitoring**: Add detailed health checks and metrics\n\n`;
  
  return md;
}

// Run analysis
if (require.main === module) {
  runAnalysis().catch(error => {
    console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
    process.exit(1);
  });
}

module.exports = { analyzeEndpoint, runAnalysis };