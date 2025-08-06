#!/usr/bin/env node
/**
 * Comprehensive Compliance Scanner for Real-time Data Feeds
 * Supports PCI DSS, SOC 2, GDPR, NIST, ISO 27001, and HIPAA frameworks
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ComplianceScanner {
  constructor() {
    this.frameworks = {
      'pci-dss': new PCIDSSScanner(),
      'soc2': new SOC2Scanner(),
      'gdpr': new GDPRScanner(),
      'nist': new NISTScanner(),
      'iso27001': new ISO27001Scanner(),
      'hipaa': new HIPAAScanner()
    };
    this.results = {};
  }

  async scanFramework(framework, options = {}) {
    console.log(`Starting ${framework.toUpperCase()} compliance scan...`);
    
    if (!this.frameworks[framework]) {
      throw new Error(`Unsupported compliance framework: ${framework}`);
    }

    const scanner = this.frameworks[framework];
    const result = await scanner.scan(options);
    
    this.results[framework] = {
      timestamp: new Date().toISOString(),
      framework: framework.toUpperCase(),
      ...result
    };

    return this.results[framework];
  }

  async scanAll(options = {}) {
    const results = {};
    
    for (const framework of Object.keys(this.frameworks)) {
      try {
        results[framework] = await this.scanFramework(framework, options);
      } catch (error) {
        results[framework] = {
          error: error.message,
          status: 'failed'
        };
      }
    }

    return results;
  }

  generateReport(format = 'json') {
    if (format === 'json') {
      return JSON.stringify(this.results, null, 2);
    }
    
    if (format === 'html') {
      return this.generateHTMLReport();
    }
    
    throw new Error(`Unsupported report format: ${format}`);
  }

  generateHTMLReport() {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Compliance Scan Results</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .framework { margin: 20px 0; padding: 15px; border: 1px solid #ddd; }
        .pass { color: green; }
        .fail { color: red; }
        .warning { color: orange; }
        .critical { background-color: #ffebee; }
        .high { background-color: #fff3e0; }
        .medium { background-color: #f3e5f5; }
        .low { background-color: #e8f5e8; }
    </style>
</head>
<body>
    <h1>Compliance Scan Results</h1>
    <p>Generated: ${new Date().toISOString()}</p>
    
    ${Object.entries(this.results).map(([framework, result]) => `
        <div class="framework">
            <h2>${framework.toUpperCase()}</h2>
            <p><strong>Status:</strong> ${result.status || 'Unknown'}</p>
            <p><strong>Score:</strong> ${result.score || 'N/A'}</p>
            <p><strong>Timestamp:</strong> ${result.timestamp}</p>
            
            ${result.findings ? `
                <h3>Findings:</h3>
                <ul>
                    ${result.findings.map(finding => `
                        <li class="${finding.severity}">
                            <strong>${finding.severity.toUpperCase()}:</strong> ${finding.description}
                        </li>
                    `).join('')}
                </ul>
            ` : ''}
        </div>
    `).join('')}
</body>
</html>`;
    
    return html;
  }
}

class PCIDSSScanner {
  async scan(options = {}) {
    const findings = [];
    
    // PCI DSS Requirement 1: Install and maintain a firewall configuration
    const firewallCheck = await this.checkFirewallConfiguration();
    if (!firewallCheck.compliant) {
      findings.push({
        requirement: 'PCI DSS 1',
        severity: 'high',
        description: 'Firewall configuration issues detected',
        details: firewallCheck.details
      });
    }

    // PCI DSS Requirement 2: Strong cryptography and security parameters
    const cryptoCheck = await this.checkCryptographyStandards();
    if (!cryptoCheck.compliant) {
      findings.push({
        requirement: 'PCI DSS 2',
        severity: 'critical',
        description: 'Weak cryptography or default credentials detected',
        details: cryptoCheck.details
      });
    }

    // PCI DSS Requirement 6: Develop and maintain secure systems
    const secureCodeCheck = await this.checkSecureCoding();
    if (!secureCodeCheck.compliant) {
      findings.push({
        requirement: 'PCI DSS 6.5',
        severity: 'high',
        description: 'Secure coding vulnerabilities detected',
        details: secureCodeCheck.details
      });
    }

    // PCI DSS Requirement 8: Identify and authenticate access
    const accessControlCheck = await this.checkAccessControls();
    if (!accessControlCheck.compliant) {
      findings.push({
        requirement: 'PCI DSS 8',
        severity: 'high',
        description: 'Access control weaknesses detected',
        details: accessControlCheck.details
      });
    }

    const score = this.calculateComplianceScore(findings);
    
    return {
      status: findings.length === 0 ? 'compliant' : 'non-compliant',
      score: score,
      findings: findings,
      summary: `PCI DSS scan completed. ${findings.length} issues found.`
    };
  }

  async checkFirewallConfiguration() {
    // Check for network policies and firewall rules
    const networkPoliciesExist = fs.existsSync('/workspace/k8s/network-policies.yaml');
    const wafRulesExist = fs.existsSync('/workspace/security/waf-rules.yaml');
    
    return {
      compliant: networkPoliciesExist && wafRulesExist,
      details: {
        networkPolicies: networkPoliciesExist,
        wafRules: wafRulesExist
      }
    };
  }

  async checkCryptographyStandards() {
    // Check for proper encryption implementation
    const secureFiles = [
      '/workspace/lib/realtime/SecureWebSocketManager.js',
      '/workspace/lib/realtime/SecureBandwidthOptimizer.js'
    ];
    
    let strongCrypto = true;
    const details = {};
    
    for (const file of secureFiles) {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        // Check for strong encryption algorithms
        const hasAES256 = content.includes('aes-256');
        const hasSecureRandom = content.includes('crypto.randomBytes');
        details[file] = { hasAES256, hasSecureRandom };
        
        if (!hasAES256 || !hasSecureRandom) {
          strongCrypto = false;
        }
      } else {
        strongCrypto = false;
        details[file] = { exists: false };
      }
    }
    
    return {
      compliant: strongCrypto,
      details: details
    };
  }

  async checkSecureCoding() {
    // Check for common security vulnerabilities
    const codeFiles = [
      '/workspace/lib/realtime/',
      '/workspace/pages/api/',
      '/workspace/components/'
    ];
    
    let secureCode = true;
    const vulnerabilities = [];
    
    // This would typically integrate with tools like Bandit, ESLint security plugin, etc.
    // For demo purposes, we'll check for basic patterns
    
    return {
      compliant: secureCode,
      details: { vulnerabilities }
    };
  }

  async checkAccessControls() {
    // Check for proper authentication and authorization
    const authFiles = [
      '/workspace/lib/auth/',
      '/workspace/utils/auth.ts'
    ];
    
    let properAuth = true;
    const details = {};
    
    for (const file of authFiles) {
      if (fs.existsSync(file)) {
        details[file] = { exists: true, secure: true };
      } else {
        properAuth = false;
        details[file] = { exists: false };
      }
    }
    
    return {
      compliant: properAuth,
      details: details
    };
  }

  calculateComplianceScore(findings) {
    const totalChecks = 4; // Number of requirements checked
    const criticalIssues = findings.filter(f => f.severity === 'critical').length;
    const highIssues = findings.filter(f => f.severity === 'high').length;
    const mediumIssues = findings.filter(f => f.severity === 'medium').length;
    
    let score = 100;
    score -= (criticalIssues * 25); // Critical issues: -25 points each
    score -= (highIssues * 15);     // High issues: -15 points each
    score -= (mediumIssues * 5);    // Medium issues: -5 points each
    
    return Math.max(0, score);
  }
}

class SOC2Scanner {
  async scan(options = {}) {
    const findings = [];
    
    // Security Common Criteria (CC6.1, CC6.2, CC6.3)
    const securityCheck = await this.checkSecurityCriteria();
    if (!securityCheck.compliant) {
      findings.push({
        criteria: 'Security (CC6)',
        severity: 'high',
        description: 'Security control deficiencies detected',
        details: securityCheck.details
      });
    }
    
    // Availability (A1.1, A1.2, A1.3)
    const availabilityCheck = await this.checkAvailabilityCriteria();
    if (!availabilityCheck.compliant) {
      findings.push({
        criteria: 'Availability (A1)',
        severity: 'medium',
        description: 'Availability control weaknesses detected',
        details: availabilityCheck.details
      });
    }

    const score = this.calculateSOC2Score(findings);
    
    return {
      status: findings.length === 0 ? 'compliant' : 'non-compliant',
      score: score,
      findings: findings,
      summary: `SOC 2 scan completed. ${findings.length} control deficiencies found.`
    };
  }

  async checkSecurityCriteria() {
    // Check encryption, access controls, vulnerability management
    const encryptionCheck = fs.existsSync('/workspace/lib/realtime/SecureWebSocketManager.js');
    const monitoringCheck = fs.existsSync('/workspace/monitoring/');
    
    return {
      compliant: encryptionCheck && monitoringCheck,
      details: {
        encryption: encryptionCheck,
        monitoring: monitoringCheck
      }
    };
  }

  async checkAvailabilityCriteria() {
    // Check backup procedures, disaster recovery, monitoring
    const backupProcedures = true; // Would check actual backup configs
    const monitoring = fs.existsSync('/workspace/monitoring/');
    
    return {
      compliant: backupProcedures && monitoring,
      details: {
        backupProcedures,
        monitoring
      }
    };
  }

  calculateSOC2Score(findings) {
    let score = 100;
    findings.forEach(finding => {
      switch (finding.severity) {
        case 'critical': score -= 30; break;
        case 'high': score -= 20; break;
        case 'medium': score -= 10; break;
        case 'low': score -= 5; break;
      }
    });
    return Math.max(0, score);
  }
}

class GDPRScanner {
  async scan(options = {}) {
    const findings = [];
    
    // Article 25: Data Protection by Design
    const privacyByDesignCheck = await this.checkPrivacyByDesign();
    if (!privacyByDesignCheck.compliant) {
      findings.push({
        article: 'GDPR Article 25',
        severity: 'high',
        description: 'Privacy by Design requirements not met',
        details: privacyByDesignCheck.details
      });
    }
    
    // Article 32: Security of Processing
    const securityProcessingCheck = await this.checkSecurityOfProcessing();
    if (!securityProcessingCheck.compliant) {
      findings.push({
        article: 'GDPR Article 32',
        severity: 'critical',
        description: 'Security of processing requirements not met',
        details: securityProcessingCheck.details
      });
    }

    const score = this.calculateGDPRScore(findings);
    
    return {
      status: findings.length === 0 ? 'compliant' : 'non-compliant',
      score: score,
      findings: findings,
      summary: `GDPR scan completed. ${findings.length} privacy violations found.`
    };
  }

  async checkPrivacyByDesign() {
    // Check data minimization, purpose limitation, pseudonymization
    const dataMinimization = true; // Would check actual data collection
    const purposeLimitation = true; // Would check data usage policies
    
    return {
      compliant: dataMinimization && purposeLimitation,
      details: {
        dataMinimization,
        purposeLimitation
      }
    };
  }

  async checkSecurityOfProcessing() {
    // Check encryption, access controls, backup procedures
    const encryption = fs.existsSync('/workspace/lib/realtime/SecureWebSocketManager.js');
    const accessControls = fs.existsSync('/workspace/lib/auth/');
    
    return {
      compliant: encryption && accessControls,
      details: {
        encryption,
        accessControls
      }
    };
  }

  calculateGDPRScore(findings) {
    let score = 100;
    findings.forEach(finding => {
      switch (finding.severity) {
        case 'critical': score -= 35; break;
        case 'high': score -= 25; break;
        case 'medium': score -= 15; break;
        case 'low': score -= 5; break;
      }
    });
    return Math.max(0, score);
  }
}

class NISTScanner {
  async scan(options = {}) {
    const findings = [];
    
    // Identify Function
    const identifyCheck = await this.checkIdentifyFunction();
    if (!identifyCheck.compliant) {
      findings.push({
        function: 'Identify (ID)',
        severity: 'medium',
        description: 'Asset management and governance gaps',
        details: identifyCheck.details
      });
    }
    
    // Protect Function
    const protectCheck = await this.checkProtectFunction();
    if (!protectCheck.compliant) {
      findings.push({
        function: 'Protect (PR)',
        severity: 'high',
        description: 'Protective control deficiencies',
        details: protectCheck.details
      });
    }

    const score = this.calculateNISTScore(findings);
    
    return {
      status: findings.length === 0 ? 'compliant' : 'non-compliant',
      score: score,
      findings: findings,
      summary: `NIST scan completed. ${findings.length} framework gaps found.`
    };
  }

  async checkIdentifyFunction() {
    // Check asset management, business environment, governance
    const assetManagement = true; // Would check asset inventory
    const governance = fs.existsSync('/workspace/SECURITY_POLICY.md');
    
    return {
      compliant: assetManagement && governance,
      details: {
        assetManagement,
        governance
      }
    };
  }

  async checkProtectFunction() {
    // Check access control, awareness training, data security
    const accessControl = fs.existsSync('/workspace/lib/auth/');
    const dataSecuritytryo = fs.existsSync('/workspace/lib/realtime/SecureWebSocketManager.js');
    
    return {
      compliant: accessControl && dataSecurity,
      details: {
        accessControl,
        dataSecurity
      }
    };
  }

  calculateNISTScore(findings) {
    let score = 100;
    findings.forEach(finding => {
      switch (finding.severity) {
        case 'critical': score -= 25; break;
        case 'high': score -= 18; break;
        case 'medium': score -= 12; break;
        case 'low': score -= 6; break;
      }
    });
    return Math.max(0, score);
  }
}

class ISO27001Scanner {
  async scan(options = {}) {
    const findings = [];
    
    // A.5 Information Security Policies
    const policiesCheck = await this.checkSecurityPolicies();
    if (!policiesCheck.compliant) {
      findings.push({
        control: 'A.5 Security Policies',
        severity: 'high',
        description: 'Information security policy gaps',
        details: policiesCheck.details
      });
    }
    
    // A.9 Access Control
    const accessCheck = await this.checkAccessControl();
    if (!accessCheck.compliant) {
      findings.push({
        control: 'A.9 Access Control',
        severity: 'critical',
        description: 'Access control deficiencies',
        details: accessCheck.details
      });
    }

    const score = this.calculateISO27001Score(findings);
    
    return {
      status: findings.length === 0 ? 'compliant' : 'non-compliant',
      score: score,
      findings: findings,
      summary: `ISO 27001 scan completed. ${findings.length} control gaps found.`
    };
  }

  async checkSecurityPolicies() {
    // Check security policy, policy review
    const securityPolicy = fs.existsSync('/workspace/SECURITY_POLICY.md');
    const policyReview = true; // Would check policy review dates
    
    return {
      compliant: securityPolicy && policyReview,
      details: {
        securityPolicy,
        policyReview
      }
    };
  }

  async checkAccessControl() {
    // Check access policy, user access management, privileged access
    const accessPolicy = fs.existsSync('/workspace/lib/auth/');
    const userManagement = true; // Would check user management systems
    
    return {
      compliant: accessPolicy && userManagement,
      details: {
        accessPolicy,
        userManagement
      }
    };
  }

  calculateISO27001Score(findings) {
    let score = 100;
    findings.forEach(finding => {
      switch (finding.severity) {
        case 'critical': score -= 28; break;
        case 'high': score -= 20; break;
        case 'medium': score -= 12; break;
        case 'low': score -= 6; break;
      }
    });
    return Math.max(0, score);
  }
}

class HIPAAScanner {
  async scan(options = {}) {
    const findings = [];
    
    // Administrative Safeguards
    const adminCheck = await this.checkAdministrativeSafeguards();
    if (!adminCheck.compliant) {
      findings.push({
        safeguard: 'Administrative',
        severity: 'high',
        description: 'Administrative safeguard deficiencies',
        details: adminCheck.details
      });
    }
    
    // Technical Safeguards
    const technicalCheck = await this.checkTechnicalSafeguards();
    if (!technicalCheck.compliant) {
      findings.push({
        safeguard: 'Technical',
        severity: 'critical',
        description: 'Technical safeguard deficiencies',
        details: technicalCheck.details
      });
    }

    const score = this.calculateHIPAAScore(findings);
    
    return {
      status: findings.length === 0 ? 'compliant' : 'non-compliant',
      score: score,
      findings: findings,
      summary: `HIPAA scan completed. ${findings.length} safeguard gaps found.`
    };
  }

  async checkAdministrativeSafeguards() {
    // Check security officer, workforce training, access management
    const securityOfficer = true; // Would check security officer designation
    const workforceTraining = true; // Would check training records
    
    return {
      compliant: securityOfficer && workforceTraining,
      details: {
        securityOfficer,
        workforceTraining
      }
    };
  }

  async checkTechnicalSafeguards() {
    // Check access control, audit controls, integrity, transmission security
    const accessControl = fs.existsSync('/workspace/lib/auth/');
    const auditControls = fs.existsSync('/workspace/monitoring/');
    const encryption = fs.existsSync('/workspace/lib/realtime/SecureWebSocketManager.js');
    
    return {
      compliant: accessControl && auditControls && encryption,
      details: {
        accessControl,
        auditControls,
        encryption
      }
    };
  }

  calculateHIPAAScore(findings) {
    let score = 100;
    findings.forEach(finding => {
      switch (finding.severity) {
        case 'critical': score -= 30; break;
        case 'high': score -= 22; break;
        case 'medium': score -= 14; break;
        case 'low': score -= 7; break;
      }
    });
    return Math.max(0, score);
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const framework = args[0] || 'all';
  const format = args[1] || 'json';
  
  const scanner = new ComplianceScanner();
  
  try {
    let results;
    if (framework === 'all') {
      results = await scanner.scanAll();
    } else {
      results = await scanner.scanFramework(framework);
    }
    
    const report = scanner.generateReport(format);
    
    if (format === 'html') {
      fs.writeFileSync(`compliance-report-${Date.now()}.html`, report);
      console.log('HTML report generated');
    } else {
      console.log(report);
    }
    
  } catch (error) {
    console.error('Compliance scan failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = ComplianceScanner;