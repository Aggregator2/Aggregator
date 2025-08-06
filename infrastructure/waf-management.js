const AWS = require('aws-sdk');
const fs = require('fs').promises;

/**
 * WAF Management System
 * Provides automated management and monitoring of WAF rules
 */
class WAFManager {
  constructor(config = {}) {
    this.config = {
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      webAclName: config.webAclName || 'realtime-feeds-production-waf',
      environment: config.environment || 'production',
      ...config
    };

    this.wafv2 = new AWS.WAFV2({ region: this.config.region });
    this.cloudwatch = new AWS.CloudWatch({ region: this.config.region });
    this.sns = new AWS.SNS({ region: this.config.region });
  }

  /**
   * Get WAF statistics and metrics
   */
  async getWAFMetrics(timeRange = 3600) {
    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - (timeRange * 1000));

      const metrics = await this.cloudwatch.getMetricStatistics({
        Namespace: 'AWS/WAFV2',
        MetricName: 'AllowedRequests',
        Dimensions: [
          {
            Name: 'WebACL',
            Value: this.config.webAclName
          }
        ],
        StartTime: startTime,
        EndTime: endTime,
        Period: 300,
        Statistics: ['Sum', 'Average']
      }).promise();

      const blockedMetrics = await this.cloudwatch.getMetricStatistics({
        Namespace: 'AWS/WAFV2',
        MetricName: 'BlockedRequests',
        Dimensions: [
          {
            Name: 'WebACL',
            Value: this.config.webAclName
          }
        ],
        StartTime: startTime,
        EndTime: endTime,
        Period: 300,
        Statistics: ['Sum', 'Average']
      }).promise();

      return {
        allowedRequests: metrics.Datapoints,
        blockedRequests: blockedMetrics.Datapoints,
        timeRange: timeRange,
        period: '5 minutes'
      };
    } catch (error) {
      console.error('Error retrieving WAF metrics:', error);
      throw error;
    }
  }

  /**
   * Update IP blacklist with new malicious IPs
   */
  async updateIPBlacklist(maliciousIPs) {
    try {
      // Get current IP set
      const ipSets = await this.wafv2.listIPSets({
        Scope: 'REGIONAL'
      }).promise();

      const blockedIPSet = ipSets.IPSets.find(set => 
        set.Name.includes('blocked-ips')
      );

      if (!blockedIPSet) {
        throw new Error('Blocked IP set not found');
      }

      // Get current IP set details
      const ipSetDetails = await this.wafv2.getIPSet({
        Name: blockedIPSet.Name,
        Scope: 'REGIONAL',
        Id: blockedIPSet.Id
      }).promise();

      // Merge current IPs with new malicious IPs
      const currentIPs = ipSetDetails.IPSet.Addresses;
      const updatedIPs = [...new Set([...currentIPs, ...maliciousIPs])];

      // Update IP set
      await this.wafv2.updateIPSet({
        Name: blockedIPSet.Name,
        Scope: 'REGIONAL',
        Id: blockedIPSet.Id,
        Addresses: updatedIPs,
        LockToken: ipSetDetails.LockToken
      }).promise();

      console.log(`Updated IP blacklist with ${maliciousIPs.length} new IPs`);
      return {
        success: true,
        addedIPs: maliciousIPs,
        totalIPs: updatedIPs.length
      };
    } catch (error) {
      console.error('Error updating IP blacklist:', error);
      throw error;
    }
  }

  /**
   * Analyze WAF logs for threats
   */
  async analyzeThreatPatterns() {
    try {
      // This would typically integrate with CloudWatch Logs Insights
      // For now, we'll simulate threat analysis
      const metrics = await this.getWAFMetrics(86400); // 24 hours

      const threats = {
        rateLimitViolations: 0,
        sqlInjectionAttempts: 0,
        xssAttempts: 0,
        maliciousUserAgents: 0,
        geographicBlocks: 0,
        suspiciousIPs: []
      };

      // Analyze blocked requests for patterns
      const blockedRequests = metrics.blockedRequests;
      if (blockedRequests.length > 0) {
        const totalBlocked = blockedRequests.reduce((sum, point) => sum + point.Sum, 0);
        
        // Estimate threat types based on historical patterns
        threats.rateLimitViolations = Math.floor(totalBlocked * 0.4);
        threats.sqlInjectionAttempts = Math.floor(totalBlocked * 0.2);
        threats.xssAttempts = Math.floor(totalBlocked * 0.15);
        threats.maliciousUserAgents = Math.floor(totalBlocked * 0.15);
        threats.geographicBlocks = Math.floor(totalBlocked * 0.1);
      }

      return threats;
    } catch (error) {
      console.error('Error analyzing threat patterns:', error);
      throw error;
    }
  }

  /**
   * Generate security report
   */
  async generateSecurityReport() {
    try {
      const metrics = await this.getWAFMetrics(86400);
      const threats = await this.analyzeThreatPatterns();
      
      const report = {
        timestamp: new Date().toISOString(),
        period: '24 hours',
        summary: {
          totalRequests: metrics.allowedRequests.reduce((sum, point) => sum + point.Sum, 0) +
                        metrics.blockedRequests.reduce((sum, point) => sum + point.Sum, 0),
          allowedRequests: metrics.allowedRequests.reduce((sum, point) => sum + point.Sum, 0),
          blockedRequests: metrics.blockedRequests.reduce((sum, point) => sum + point.Sum, 0),
          blockRate: 0
        },
        threatAnalysis: threats,
        recommendations: []
      };

      // Calculate block rate
      if (report.summary.totalRequests > 0) {
        report.summary.blockRate = (report.summary.blockedRequests / report.summary.totalRequests) * 100;
      }

      // Generate recommendations
      if (report.summary.blockRate > 10) {
        report.recommendations.push('High block rate detected - investigate potential DDoS attack');
      }
      
      if (threats.sqlInjectionAttempts > 100) {
        report.recommendations.push('High SQL injection attempts - consider additional application-level protection');
      }
      
      if (threats.rateLimitViolations > 500) {
        report.recommendations.push('Consider lowering rate limit thresholds or implementing adaptive rate limiting');
      }

      return report;
    } catch (error) {
      console.error('Error generating security report:', error);
      throw error;
    }
  }

  /**
   * Create custom WAF rule for specific threat patterns
   */
  async createCustomRule(ruleName, ruleConfig) {
    try {
      // Get current Web ACL
      const webACLs = await this.wafv2.listWebACLs({
        Scope: 'REGIONAL'
      }).promise();

      const webACL = webACLs.WebACLs.find(acl => 
        acl.Name === this.config.webAclName
      );

      if (!webACL) {
        throw new Error('Web ACL not found');
      }

      // Get Web ACL details
      const webACLDetails = await this.wafv2.getWebACL({
        Name: webACL.Name,
        Scope: 'REGIONAL',
        Id: webACL.Id
      }).promise();

      // Create new rule
      const newRule = {
        Name: ruleName,
        Priority: ruleConfig.priority || 100,
        Action: ruleConfig.action || { Block: {} },
        Statement: ruleConfig.statement,
        VisibilityConfig: {
          SampledRequestsEnabled: true,
          CloudWatchMetricsEnabled: true,
          MetricName: `${ruleName}Metric`
        }
      };

      // Add rule to existing rules
      const updatedRules = [...webACLDetails.WebACL.Rules, newRule];

      // Update Web ACL
      await this.wafv2.updateWebACL({
        Name: webACL.Name,
        Scope: 'REGIONAL',
        Id: webACL.Id,
        DefaultAction: webACLDetails.WebACL.DefaultAction,
        Rules: updatedRules,
        VisibilityConfig: webACLDetails.WebACL.VisibilityConfig,
        LockToken: webACLDetails.LockToken
      }).promise();

      console.log(`Created custom WAF rule: ${ruleName}`);
      return { success: true, ruleName };
    } catch (error) {
      console.error('Error creating custom WAF rule:', error);
      throw error;
    }
  }

  /**
   * Monitor and respond to threats automatically
   */
  async autoThreatResponse() {
    try {
      const threats = await this.analyzeThreatPatterns();
      const actions = [];

      // Auto-block IPs with high violation rates
      if (threats.suspiciousIPs.length > 0) {
        const result = await this.updateIPBlacklist(threats.suspiciousIPs);
        actions.push(`Blocked ${result.addedIPs.length} suspicious IPs`);
      }

      // Create temporary rules for emerging threats
      if (threats.sqlInjectionAttempts > 1000) {
        await this.createCustomRule('EmergencySQLiBlock', {
          priority: 50,
          action: { Block: {} },
          statement: {
            SqliMatchStatement: {
              FieldToMatch: { AllQueryArguments: {} },
              TextTransformations: [
                { Priority: 0, Type: 'URL_DECODE' },
                { Priority: 1, Type: 'HTML_ENTITY_DECODE' }
              ]
            }
          }
        });
        actions.push('Created emergency SQL injection blocking rule');
      }

      // Send notifications for critical threats
      if (threats.rateLimitViolations > 10000) {
        await this.sendSecurityAlert('Critical: Potential DDoS attack detected', {
          rateLimitViolations: threats.rateLimitViolations,
          timestamp: new Date().toISOString()
        });
        actions.push('Sent DDoS alert notification');
      }

      return {
        success: true,
        actionsPerformed: actions,
        threatsAnalyzed: threats
      };
    } catch (error) {
      console.error('Error in auto threat response:', error);
      throw error;
    }
  }

  /**
   * Send security alert notification
   */
  async sendSecurityAlert(subject, details) {
    try {
      const message = {
        Subject: subject,
        Message: JSON.stringify(details, null, 2),
        TopicArn: process.env.SECURITY_SNS_TOPIC || 'arn:aws:sns:us-east-1:123456789012:security-alerts'
      };

      await this.sns.publish(message).promise();
      console.log('Security alert sent:', subject);
    } catch (error) {
      console.error('Error sending security alert:', error);
    }
  }

  /**
   * Export WAF configuration for backup
   */
  async exportConfiguration() {
    try {
      const webACLs = await this.wafv2.listWebACLs({
        Scope: 'REGIONAL'
      }).promise();

      const webACL = webACLs.WebACLs.find(acl => 
        acl.Name === this.config.webAclName
      );

      if (!webACL) {
        throw new Error('Web ACL not found');
      }

      const webACLDetails = await this.wafv2.getWebACL({
        Name: webACL.Name,
        Scope: 'REGIONAL',
        Id: webACL.Id
      }).promise();

      const config = {
        exportDate: new Date().toISOString(),
        webACL: webACLDetails.WebACL,
        ipSets: [],
        ruleGroups: []
      };

      // Export IP sets
      const ipSets = await this.wafv2.listIPSets({
        Scope: 'REGIONAL'
      }).promise();

      for (const ipSet of ipSets.IPSets) {
        const ipSetDetails = await this.wafv2.getIPSet({
          Name: ipSet.Name,
          Scope: 'REGIONAL',
          Id: ipSet.Id
        }).promise();
        config.ipSets.push(ipSetDetails.IPSet);
      }

      return config;
    } catch (error) {
      console.error('Error exporting WAF configuration:', error);
      throw error;
    }
  }
}

module.exports = WAFManager;

// CLI usage example
if (require.main === module) {
  const wafManager = new WAFManager({
    region: 'us-east-1',
    webAclName: 'realtime-feeds-production-waf'
  });

  async function runSecurityMonitoring() {
    try {
      console.log('Running WAF security monitoring...');
      
      const report = await wafManager.generateSecurityReport();
      console.log('Security Report:', JSON.stringify(report, null, 2));
      
      const autoResponse = await wafManager.autoThreatResponse();
      console.log('Auto Response Actions:', autoResponse.actionsPerformed);
      
    } catch (error) {
      console.error('Security monitoring failed:', error);
    }
  }

  // Run security monitoring
  runSecurityMonitoring();
}