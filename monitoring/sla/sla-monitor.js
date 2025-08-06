/**
 * SLA Monitoring Service for SwappiQ Protocol
 * Author: SwappiQ Protocol
 * Description: Automated SLA monitoring, reporting, and alerting
 */

const express = require('express');
const promClient = require('prom-client');
const yaml = require('js-yaml');
const fs = require('fs');
const cron = require('node-cron');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');

class SLAMonitor {
  constructor(configPath) {
    this.config = this.loadConfig(configPath);
    this.app = express();
    this.setupMetrics();
    this.setupRoutes();
    this.setupScheduledTasks();
    this.prometheusClient = axios.create({
      baseURL: this.config.integrations.prometheus.endpoint,
      timeout: parseInt(this.config.integrations.prometheus.query_timeout.replace('s', '')) * 1000
    });
  }

  loadConfig(configPath) {
    try {
      const configFile = fs.readFileSync(configPath, 'utf8');
      return yaml.load(configFile);
    } catch (error) {
      console.error('Error loading SLA configuration:', error);
      process.exit(1);
    }
  }

  setupMetrics() {
    this.register = new promClient.Registry();

    // SLA compliance metrics
    this.slaComplianceGauge = new promClient.Gauge({
      name: 'swappiq_sla_compliance_percentage',
      help: 'SLA compliance percentage for each service',
      labelNames: ['sla_name', 'service', 'measurement_window'],
      registers: [this.register]
    });

    // Error budget metrics
    this.errorBudgetGauge = new promClient.Gauge({
      name: 'swappiq_error_budget_remaining_percentage',
      help: 'Remaining error budget percentage',
      labelNames: ['service', 'budget_type'],
      registers: [this.register]
    });

    // SLA breach counter
    this.slaBreachCounter = new promClient.Counter({
      name: 'swappiq_sla_breaches_total',
      help: 'Total number of SLA breaches',
      labelNames: ['sla_name', 'service', 'severity'],
      registers: [this.register]
    });

    // SLA target gauge
    this.slaTargetGauge = new promClient.Gauge({
      name: 'swappiq_sla_target',
      help: 'SLA target value',
      labelNames: ['sla_name', 'service'],
      registers: [this.register]
    });

    // SLA current value gauge
    this.slaCurrentValueGauge = new promClient.Gauge({
      name: 'swappiq_sla_current_value',
      help: 'Current SLA measurement value',
      labelNames: ['sla_name', 'service'],
      registers: [this.register]
    });

    // Error budget burn rate
    this.budgetBurnRateGauge = new promClient.Gauge({
      name: 'swappiq_error_budget_burn_rate',
      help: 'Error budget burn rate (budget consumed per hour)',
      labelNames: ['service', 'budget_type'],
      registers: [this.register]
    });

    promClient.collectDefaultMetrics({ register: this.register });
  }

  setupRoutes() {
    // Metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        res.set('Content-Type', this.register.contentType);
        res.end(await this.register.metrics());
      } catch (error) {
        res.status(500).end(error.message);
      }
    });

    // SLA status endpoint
    this.app.get('/sla/status', async (req, res) => {
      try {
        const status = await this.getSLAStatus();
        res.json(status);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // SLA report endpoint
    this.app.get('/sla/report/:period', async (req, res) => {
      try {
        const { period } = req.params;
        const report = await this.generateReport(period);
        res.json(report);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Error budget status
    this.app.get('/sla/error-budget', async (req, res) => {
      try {
        const budgetStatus = await this.getErrorBudgetStatus();
        res.json(budgetStatus);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });
  }

  setupScheduledTasks() {
    // Monitor SLAs every minute
    cron.schedule('* * * * *', () => {
      this.monitorSLAs().catch(console.error);
    });

    // Calculate error budgets every 5 minutes
    cron.schedule('*/5 * * * *', () => {
      this.calculateErrorBudgets().catch(console.error);
    });

    // Daily report generation
    if (this.config.reporting.schedule.daily_report) {
      cron.schedule(this.config.reporting.schedule.daily_report, () => {
        this.generateAndSendReport('daily').catch(console.error);
      });
    }

    // Weekly report generation
    if (this.config.reporting.schedule.weekly_report) {
      cron.schedule(this.config.reporting.schedule.weekly_report, () => {
        this.generateAndSendReport('weekly').catch(console.error);
      });
    }

    // Monthly report generation
    if (this.config.reporting.schedule.monthly_report) {
      cron.schedule(this.config.reporting.schedule.monthly_report, () => {
        this.generateAndSendReport('monthly').catch(console.error);
      });
    }

    console.log('SLA monitoring scheduled tasks configured');
  }

  async monitorSLAs() {
    for (const [slaName, slaConfig] of Object.entries(this.config.sla_definitions)) {
      try {
        const currentValue = await this.queryPrometheus(slaConfig.metric_query);
        const target = slaConfig.target;
        const alertThreshold = slaConfig.alert_threshold;

        // Update metrics
        this.slaTargetGauge.labels(slaName, this.extractService(slaName)).set(target);
        this.slaCurrentValueGauge.labels(slaName, this.extractService(slaName)).set(currentValue);

        // Calculate compliance
        let compliance;
        if (slaName.includes('error_rate')) {
          compliance = currentValue <= target ? 100 : (target / currentValue) * 100;
        } else {
          compliance = Math.min((currentValue / target) * 100, 100);
        }

        this.slaComplianceGauge
          .labels(slaName, this.extractService(slaName), slaConfig.measurement_window)
          .set(compliance);

        // Check for SLA breach
        let isBreach = false;
        if (slaName.includes('error_rate')) {
          isBreach = currentValue > alertThreshold;
        } else {
          isBreach = currentValue < alertThreshold;
        }

        if (isBreach) {
          await this.handleSLABreach(slaName, slaConfig, currentValue, target);
        }

      } catch (error) {
        console.error(`Error monitoring SLA ${slaName}:`, error);
      }
    }
  }

  async calculateErrorBudgets() {
    const services = this.config.error_budgets.services;
    
    for (const [serviceName, budgetConfig] of Object.entries(services)) {
      try {
        // Calculate availability error budget
        if (budgetConfig.availability_budget) {
          const uptime = await this.queryPrometheus(
            `avg_over_time(up{job="${serviceName}"}[${this.config.error_budgets.budget_period}]) * 100`
          );
          
          const allowedDowntime = budgetConfig.availability_budget;
          const actualDowntime = 100 - uptime;
          const budgetRemaining = Math.max(0, ((allowedDowntime - actualDowntime) / allowedDowntime) * 100);
          
          this.errorBudgetGauge
            .labels(serviceName, 'availability')
            .set(budgetRemaining);

          // Calculate burn rate (downtime per hour)
          const burnRate = actualDowntime / (30 * 24); // Assuming 30-day budget period
          this.budgetBurnRateGauge
            .labels(serviceName, 'availability')
            .set(burnRate);
        }

        // Calculate error rate budget
        if (budgetConfig.error_rate_budget) {
          const errorRate = await this.queryPrometheus(
            `sum(rate(swappiq_http_requests_total{job="${serviceName}",status=~"5.."}[1h])) / sum(rate(swappiq_http_requests_total{job="${serviceName}"}[1h])) * 100`
          );
          
          const allowedErrorRate = budgetConfig.error_rate_budget;
          const budgetRemaining = Math.max(0, ((allowedErrorRate - errorRate) / allowedErrorRate) * 100);
          
          this.errorBudgetGauge
            .labels(serviceName, 'error_rate')
            .set(budgetRemaining);
        }

        // Check budget alerts
        await this.checkBudgetAlerts(serviceName, budgetConfig);

      } catch (error) {
        console.error(`Error calculating error budget for ${serviceName}:`, error);
      }
    }
  }

  async checkBudgetAlerts(serviceName, budgetConfig) {
    const availabilityBudget = await this.getMetricValue(
      'swappiq_error_budget_remaining_percentage',
      { service: serviceName, budget_type: 'availability' }
    );

    const warningThreshold = this.config.alerting.budget_alerts.warning_threshold;
    const criticalThreshold = this.config.alerting.budget_alerts.critical_threshold;

    if (availabilityBudget <= criticalThreshold) {
      await this.sendBudgetAlert(serviceName, 'critical', availabilityBudget);
    } else if (availabilityBudget <= warningThreshold) {
      await this.sendBudgetAlert(serviceName, 'warning', availabilityBudget);
    }
  }

  async handleSLABreach(slaName, slaConfig, currentValue, target) {
    const service = this.extractService(slaName);
    const severity = this.calculateSeverity(currentValue, target, slaConfig.alert_threshold);
    
    // Increment breach counter
    this.slaBreachCounter.labels(slaName, service, severity).inc();

    // Send notifications
    const message = {
      title: `SLA Breach: ${slaName}`,
      description: `SLA breach detected for ${slaName}`,
      service: service,
      current_value: currentValue,
      target: target,
      severity: severity,
      measurement_window: slaConfig.measurement_window
    };

    await this.sendSLAAlert(message, slaConfig.notification_channels);
    
    console.log(`SLA breach detected: ${slaName}, Current: ${currentValue}, Target: ${target}`);
  }

  async queryPrometheus(query) {
    try {
      const response = await this.prometheusClient.get('/api/v1/query', {
        params: { query }
      });
      
      if (response.data.status === 'success' && response.data.data.result.length > 0) {
        return parseFloat(response.data.data.result[0].value[1]);
      }
      
      return 0;
    } catch (error) {
      console.error('Prometheus query error:', error.message);
      return 0;
    }
  }

  async getSLAStatus() {
    const status = {
      overall_health: 'healthy',
      slas: {},
      error_budgets: {},
      last_updated: new Date().toISOString()
    };

    // Get current SLA status
    for (const slaName of Object.keys(this.config.sla_definitions)) {
      const compliance = await this.getMetricValue('swappiq_sla_compliance_percentage', {
        sla_name: slaName
      });
      
      const currentValue = await this.getMetricValue('swappiq_sla_current_value', {
        sla_name: slaName
      });
      
      const target = await this.getMetricValue('swappiq_sla_target', {
        sla_name: slaName
      });

      status.slas[slaName] = {
        compliance: compliance,
        current_value: currentValue,
        target: target,
        status: compliance >= 99 ? 'healthy' : compliance >= 95 ? 'warning' : 'critical'
      };

      if (compliance < 95) {
        status.overall_health = 'critical';
      } else if (compliance < 99 && status.overall_health === 'healthy') {
        status.overall_health = 'warning';
      }
    }

    // Get error budget status
    for (const serviceName of Object.keys(this.config.error_budgets.services)) {
      const availabilityBudget = await this.getMetricValue(
        'swappiq_error_budget_remaining_percentage',
        { service: serviceName, budget_type: 'availability' }
      );

      status.error_budgets[serviceName] = {
        availability_budget_remaining: availabilityBudget,
        status: availabilityBudget > 50 ? 'healthy' : availabilityBudget > 25 ? 'warning' : 'critical'
      };
    }

    return status;
  }

  async generateReport(period) {
    const endTime = new Date();
    let startTime;
    
    switch (period) {
      case 'daily':
        startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'weekly':
        startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        startTime = new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        throw new Error('Invalid period. Use daily, weekly, or monthly.');
    }

    const report = {
      period: period,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      summary: {
        total_slas: Object.keys(this.config.sla_definitions).length,
        slas_met: 0,
        slas_breached: 0,
        overall_compliance: 0
      },
      sla_details: {},
      error_budget_summary: {},
      recommendations: []
    };

    // Calculate SLA compliance for the period
    let totalCompliance = 0;
    for (const [slaName, slaConfig] of Object.entries(this.config.sla_definitions)) {
      const compliance = await this.getMetricValue('swappiq_sla_compliance_percentage', {
        sla_name: slaName
      });
      
      report.sla_details[slaName] = {
        target: slaConfig.target,
        compliance: compliance,
        status: compliance >= slaConfig.target ? 'met' : 'breached',
        description: slaConfig.description
      };

      if (compliance >= slaConfig.target) {
        report.summary.slas_met++;
      } else {
        report.summary.slas_breached++;
      }

      totalCompliance += compliance;
    }

    report.summary.overall_compliance = totalCompliance / Object.keys(this.config.sla_definitions).length;

    // Add recommendations
    if (report.summary.slas_breached > 0) {
      report.recommendations.push('Review breached SLAs and implement corrective actions');
    }
    
    if (report.summary.overall_compliance < 99) {
      report.recommendations.push('Consider scaling infrastructure to improve service reliability');
    }

    return report;
  }

  async getMetricValue(metricName, labels = {}) {
    try {
      const metrics = await this.register.metrics();
      // This is a simplified implementation - in production, you'd parse the metrics properly
      return Math.random() * 100; // Placeholder
    } catch (error) {
      console.error(`Error getting metric ${metricName}:`, error);
      return 0;
    }
  }

  extractService(slaName) {
    if (slaName.includes('api')) return 'api';
    if (slaName.includes('trading')) return 'trading-engine';
    if (slaName.includes('settlement')) return 'settlement';
    if (slaName.includes('database')) return 'database';
    if (slaName.includes('websocket')) return 'websocket';
    return 'unknown';
  }

  calculateSeverity(currentValue, target, alertThreshold) {
    const deviation = Math.abs(currentValue - target) / target;
    if (deviation > 0.1) return 'critical';
    if (deviation > 0.05) return 'warning';
    return 'info';
  }

  async sendSLAAlert(message, channels) {
    // Implementation would send alerts via configured channels
    console.log('SLA Alert:', message);
  }

  async sendBudgetAlert(serviceName, severity, budgetRemaining) {
    const message = {
      title: `Error Budget Alert: ${serviceName}`,
      description: `Error budget ${severity} threshold reached`,
      service: serviceName,
      budget_remaining: budgetRemaining,
      severity: severity
    };
    
    console.log('Budget Alert:', message);
  }

  async generateAndSendReport(period) {
    try {
      const report = await this.generateReport(period);
      // Implementation would generate PDF/HTML and send via email
      console.log(`${period} SLA report generated:`, report.summary);
    } catch (error) {
      console.error(`Error generating ${period} report:`, error);
    }
  }

  start() {
    const port = process.env.SLA_MONITOR_PORT || 8092;
    this.app.listen(port, () => {
      console.log(`SLA Monitor started on port ${port}`);
      console.log(`Monitoring ${Object.keys(this.config.sla_definitions).length} SLAs`);
      console.log(`Error budgets configured for ${Object.keys(this.config.error_budgets.services).length} services`);
    });
  }
}

// Configuration and startup
const configPath = process.env.SLA_CONFIG_PATH || '/workspace/monitoring/sla/sla-config.yml';

if (require.main === module) {
  const monitor = new SLAMonitor(configPath);
  monitor.start();
}

module.exports = SLAMonitor;