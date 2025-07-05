import { EventEmitter } from 'events';
import { Notification } from '../../types/notifications';

export interface NotificationEvents {
  'notification:created': (notification: Notification) => void;
  'notification:updated': (notification: Notification) => void;
  'notification:deleted': (data: { notificationId: string; userId: string }) => void;
  'notification:read': (data: { notification: Notification; userId: string }) => void;
  'notification:allRead': (data: { userId: string; count: number }) => void;
}

export class NotificationEventEmitter extends EventEmitter {
  private static instance: NotificationEventEmitter;

  private constructor() {
    super();
    this.setMaxListeners(100); // Increase for multiple listeners
  }

  static getInstance(): NotificationEventEmitter {
    if (!NotificationEventEmitter.instance) {
      NotificationEventEmitter.instance = new NotificationEventEmitter();
    }
    return NotificationEventEmitter.instance;
  }

  // Type-safe emit
  emit<K extends keyof NotificationEvents>(
    event: K,
    ...args: Parameters<NotificationEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  // Type-safe on
  on<K extends keyof NotificationEvents>(
    event: K,
    listener: NotificationEvents[K]
  ): this {
    return super.on(event, listener);
  }

  // Type-safe once
  once<K extends keyof NotificationEvents>(
    event: K,
    listener: NotificationEvents[K]
  ): this {
    return super.once(event, listener);
  }

  // Type-safe off
  off<K extends keyof NotificationEvents>(
    event: K,
    listener: NotificationEvents[K]
  ): this {
    return super.off(event, listener);
  }
}

export const notificationEventEmitter = NotificationEventEmitter.getInstance();