import { Model, DataTypes, Sequelize } from 'sequelize';

export enum WebhookEventType {
  ORDER_CREATED = 'order.created',
  ORDER_FILLED = 'order.filled',
  ORDER_CANCELLED = 'order.cancelled',
  TRADE_EXECUTED = 'trade.executed',
  SETTLEMENT_COMPLETED = 'settlement.completed',
  SETTLEMENT_CLAIMED = 'settlement.claimed'
}

export enum WebhookStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  FAILED = 'failed'
}

export interface WebhookAttributes {
  id: string;
  userId: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  status: WebhookStatus;
  description?: string;
  headers?: Record<string, string>;
  ipWhitelist?: string[];
  retryConfig?: {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
    timeout: number;
  };
  metadata?: Record<string, any>;
  lastTriggeredAt?: Date;
  failureCount: number;
  successCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Webhook extends Model<WebhookAttributes> implements WebhookAttributes {
  public id!: string;
  public userId!: string;
  public url!: string;
  public secret!: string;
  public events!: WebhookEventType[];
  public status!: WebhookStatus;
  public description?: string;
  public headers?: Record<string, string>;
  public ipWhitelist?: string[];
  public retryConfig?: {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
    timeout: number;
  };
  public metadata?: Record<string, any>;
  public lastTriggeredAt?: Date;
  public failureCount!: number;
  public successCount!: number;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  static initModel(sequelize: Sequelize): typeof Webhook {
    Webhook.init({
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      userId: {
        type: DataTypes.STRING,
        allowNull: false,
        indexes: [{ fields: ['userId'] }]
      },
      url: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          isUrl: true,
          isHttps(value: string) {
            if (process.env.NODE_ENV === 'production' && !value.startsWith('https://')) {
              throw new Error('Webhook URL must use HTTPS in production');
            }
          }
        }
      },
      secret: {
        type: DataTypes.STRING,
        allowNull: false
      },
      events: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: false,
        defaultValue: [],
        validate: {
          isValidEvents(value: string[]) {
            const validEvents = Object.values(WebhookEventType);
            for (const event of value) {
              if (!validEvents.includes(event as WebhookEventType)) {
                throw new Error(`Invalid event type: ${event}`);
              }
            }
          }
        }
      },
      status: {
        type: DataTypes.ENUM(...Object.values(WebhookStatus)),
        defaultValue: WebhookStatus.ACTIVE,
        allowNull: false
      },
      description: {
        type: DataTypes.STRING,
        allowNull: true
      },
      headers: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {}
      },
      ipWhitelist: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: true,
        defaultValue: []
      },
      retryConfig: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {
          maxRetries: 5,
          initialDelay: 1000, // 1 second
          maxDelay: 3600000, // 1 hour
          timeout: 30000 // 30 seconds
        }
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {}
      },
      lastTriggeredAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      failureCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      successCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
      }
    }, {
      sequelize,
      modelName: 'Webhook',
      tableName: 'webhooks',
      timestamps: true,
      indexes: [
        { fields: ['userId'] },
        { fields: ['status'] },
        { fields: ['events'] }
      ]
    });

    return Webhook;
  }
}

// Webhook Event Model
export interface WebhookEventAttributes {
  id: string;
  webhookId: string;
  eventId: string;
  type: WebhookEventType;
  payload: any;
  signature: string;
  attempts: number;
  status: 'pending' | 'delivered' | 'failed';
  nextRetryAt?: Date;
  lastAttemptAt?: Date;
  deliveredAt?: Date;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class WebhookEvent extends Model<WebhookEventAttributes> implements WebhookEventAttributes {
  public id!: string;
  public webhookId!: string;
  public eventId!: string;
  public type!: WebhookEventType;
  public payload!: any;
  public signature!: string;
  public attempts!: number;
  public status!: 'pending' | 'delivered' | 'failed';
  public nextRetryAt?: Date;
  public lastAttemptAt?: Date;
  public deliveredAt?: Date;
  public responseStatus?: number;
  public responseBody?: string;
  public error?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  static initModel(sequelize: Sequelize): typeof WebhookEvent {
    WebhookEvent.init({
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      webhookId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'webhooks',
          key: 'id'
        }
      },
      eventId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false
      },
      payload: {
        type: DataTypes.JSONB,
        allowNull: false
      },
      signature: {
        type: DataTypes.STRING,
        allowNull: false
      },
      attempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      status: {
        type: DataTypes.ENUM('pending', 'delivered', 'failed'),
        defaultValue: 'pending',
        allowNull: false
      },
      nextRetryAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      lastAttemptAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      deliveredAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      responseStatus: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      responseBody: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      error: {
        type: DataTypes.TEXT,
        allowNull: true
      }
    }, {
      sequelize,
      modelName: 'WebhookEvent',
      tableName: 'webhook_events',
      timestamps: true,
      indexes: [
        { fields: ['webhookId'] },
        { fields: ['eventId'] },
        { fields: ['type'] },
        { fields: ['status'] },
        { fields: ['nextRetryAt'] },
        { fields: ['createdAt'] }
      ]
    });

    return WebhookEvent;
  }
}

// Define associations
export function setupWebhookAssociations() {
  Webhook.hasMany(WebhookEvent, {
    foreignKey: 'webhookId',
    as: 'events'
  });

  WebhookEvent.belongsTo(Webhook, {
    foreignKey: 'webhookId',
    as: 'webhook'
  });
}