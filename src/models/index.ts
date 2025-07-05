import { Sequelize } from 'sequelize';
import { Webhook, WebhookEvent, setupWebhookAssociations } from './webhook';

// Initialize Sequelize
const sequelize = new Sequelize(process.env.DATABASE_URL || 'postgres://localhost:5432/trading_platform', {
  dialect: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    min: parseInt(process.env.DATABASE_POOL_MIN || '2'),
    max: parseInt(process.env.DATABASE_POOL_MAX || '10'),
    idle: 30000,
    acquire: 60000,
  },
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' && process.env.DATABASE_SSL === 'true' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  }
});

// Initialize models
Webhook.initModel(sequelize);
WebhookEvent.initModel(sequelize);

// Setup associations
setupWebhookAssociations();

// Export everything
export {
  sequelize,
  Webhook,
  WebhookEvent
};