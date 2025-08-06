#!/usr/bin/env node

import { MonitoringSetup, defaultMonitoringConfig } from './setup/MonitoringSetup';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🚀 Trading System Monitoring Infrastructure Setup');
  console.log('==============================================\n');

  // Override default config with environment variables
  const config = {
    ...defaultMonitoringConfig,
    prometheus: {
      ...defaultMonitoringConfig.prometheus,
      port: parseInt(process.env.PROMETHEUS_PORT || '9090'),
    },
    grafana: {
      ...defaultMonitoringConfig.grafana,
      port: parseInt(process.env.GRAFANA_PORT || '3000'),
      adminPassword: process.env.GRAFANA_PASSWORD || 'admin123',
    },
    alerting: {
      ...defaultMonitoringConfig.alerting,
      email: {
        ...defaultMonitoringConfig.alerting.email,
        enabled: process.env.SMTP_HOST ? true : false,
        smtp: {
          host: process.env.SMTP_HOST || '',
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER || '',
            pass: process.env.SMTP_PASS || '',
          },
        },
        recipients: process.env.ALERT_RECIPIENTS?.split(',') || [],
        from: process.env.ALERT_FROM || 'alerts@trading-system.com',
      },
      slack: {
        ...defaultMonitoringConfig.alerting.slack,
        enabled: process.env.SLACK_WEBHOOK ? true : false,
        webhookUrl: process.env.SLACK_WEBHOOK || '',
        channel: process.env.SLACK_CHANNEL || '#alerts',
      },
    },
    streaming: {
      ...defaultMonitoringConfig.streaming,
      port: parseInt(process.env.METRICS_STREAM_PORT || '8080'),
      authEnabled: process.env.METRICS_AUTH === 'true',
      jwtSecret: process.env.JWT_SECRET,
    },
    docker: process.env.USE_DOCKER !== 'false',
  };

  const setup = new MonitoringSetup(config);

  try {
    // Setup monitoring infrastructure
    await setup.setup();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n⚡ Received SIGINT, shutting down gracefully...');
      await setup.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n⚡ Received SIGTERM, shutting down gracefully...');
      await setup.stop();
      process.exit(0);
    });

    console.log('\n✅ Monitoring infrastructure is running!');
    console.log('Press Ctrl+C to stop\n');

    // Keep the process running
    await new Promise(() => {});

  } catch (error) {
    console.error('❌ Failed to setup monitoring:', error);
    process.exit(1);
  }
}

// Run the setup
main().catch(console.error);