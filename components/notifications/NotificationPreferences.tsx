import React, { useState, useEffect } from 'react';
import { Switch } from '@headlessui/react';
import { BellIcon, EnvelopeIcon, DevicePhoneMobileIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import { NotificationType, NotificationChannel } from '../../src/types/notifications';

interface NotificationPreferencesProps {
  userId: string;
}

interface ChannelPreferences {
  [key: string]: NotificationChannel[];
}

interface TimeRange {
  start: string;
  end: string;
}

export const NotificationPreferences: React.FC<NotificationPreferencesProps> = ({ userId }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferences, setPreferences] = useState({
    emailNotifications: true,
    smsNotifications: false,
    pushNotifications: true,
    webhookNotifications: true,
    doNotDisturb: false,
    doNotDisturbTime: { start: '22:00', end: '08:00' } as TimeRange,
    channels: {} as ChannelPreferences
  });

  // Notification types grouped by category
  const notificationCategories = [
    {
      name: 'Orders',
      types: [
        { type: NotificationType.ORDER_PLACED, label: 'Order Placed' },
        { type: NotificationType.ORDER_FILLED, label: 'Order Filled' },
        { type: NotificationType.ORDER_PARTIALLY_FILLED, label: 'Order Partially Filled' },
        { type: NotificationType.ORDER_CANCELLED, label: 'Order Cancelled' },
        { type: NotificationType.ORDER_FAILED, label: 'Order Failed' }
      ]
    },
    {
      name: 'Trades',
      types: [
        { type: NotificationType.TRADE_EXECUTED, label: 'Trade Executed' },
        { type: NotificationType.TRADE_MATCHED, label: 'Trade Matched' }
      ]
    },
    {
      name: 'Settlements',
      types: [
        { type: NotificationType.SETTLEMENT_INITIATED, label: 'Settlement Initiated' },
        { type: NotificationType.SETTLEMENT_COMPLETED, label: 'Settlement Completed' },
        { type: NotificationType.SETTLEMENT_FAILED, label: 'Settlement Failed' }
      ]
    },
    {
      name: 'Alerts',
      types: [
        { type: NotificationType.PRICE_ALERT, label: 'Price Alerts' },
        { type: NotificationType.SYSTEM_MAINTENANCE, label: 'System Maintenance' },
        { type: NotificationType.ACCOUNT_UPDATE, label: 'Account Updates' }
      ]
    }
  ];

  // Load preferences
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const response = await fetch(`/api/notifications/preferences?userId=${userId}`);
        if (response.ok) {
          const data = await response.json();
          setPreferences({
            ...preferences,
            ...data,
            doNotDisturbTime: data.doNotDisturbStart && data.doNotDisturbEnd ? {
              start: data.doNotDisturbStart,
              end: data.doNotDisturbEnd
            } : preferences.doNotDisturbTime
          });
        }
      } catch (error) {
        console.error('Failed to load preferences:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, [userId]);

  // Save preferences
  const savePreferences = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/notifications/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          ...preferences,
          doNotDisturbStart: preferences.doNotDisturb ? preferences.doNotDisturbTime.start : null,
          doNotDisturbEnd: preferences.doNotDisturb ? preferences.doNotDisturbTime.end : null
        })
      });

      if (!response.ok) {
        throw new Error('Failed to save preferences');
      }
    } catch (error) {
      console.error('Failed to save preferences:', error);
    } finally {
      setSaving(false);
    }
  };

  // Toggle channel for notification type
  const toggleChannel = (type: NotificationType, channel: NotificationChannel) => {
    setPreferences(prev => {
      const channels = { ...prev.channels };
      const currentChannels = channels[type] || [];
      
      if (currentChannels.includes(channel)) {
        channels[type] = currentChannels.filter(c => c !== channel);
      } else {
        channels[type] = [...currentChannels, channel];
      }
      
      return { ...prev, channels };
    });
  };

  // Check if channel is enabled for type
  const isChannelEnabled = (type: NotificationType, channel: NotificationChannel): boolean => {
    return preferences.channels[type]?.includes(channel) || false;
  };

  if (loading) {
    return <div className="p-8 text-center">Loading preferences...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Notification Preferences
          </h2>
        </div>

        <div className="p-6 space-y-6">
          {/* Global Settings */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Global Settings
            </h3>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <EnvelopeIcon className="h-5 w-5 text-gray-400 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      Email Notifications
                    </p>
                    <p className="text-sm text-gray-500">
                      Receive notifications via email
                    </p>
                  </div>
                </div>
                <Switch
                  checked={preferences.emailNotifications}
                  onChange={(checked) => setPreferences({ ...preferences, emailNotifications: checked })}
                  className={`${
                    preferences.emailNotifications ? 'bg-blue-600' : 'bg-gray-200'
                  } relative inline-flex h-6 w-11 items-center rounded-full`}
                >
                  <span className={`${
                    preferences.emailNotifications ? 'translate-x-6' : 'translate-x-1'
                  } inline-block h-4 w-4 transform rounded-full bg-white transition`} />
                </Switch>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <DevicePhoneMobileIcon className="h-5 w-5 text-gray-400 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      SMS Notifications
                    </p>
                    <p className="text-sm text-gray-500">
                      Receive notifications via SMS
                    </p>
                  </div>
                </div>
                <Switch
                  checked={preferences.smsNotifications}
                  onChange={(checked) => setPreferences({ ...preferences, smsNotifications: checked })}
                  className={`${
                    preferences.smsNotifications ? 'bg-blue-600' : 'bg-gray-200'
                  } relative inline-flex h-6 w-11 items-center rounded-full`}
                >
                  <span className={`${
                    preferences.smsNotifications ? 'translate-x-6' : 'translate-x-1'
                  } inline-block h-4 w-4 transform rounded-full bg-white transition`} />
                </Switch>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <GlobeAltIcon className="h-5 w-5 text-gray-400 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      Webhook Notifications
                    </p>
                    <p className="text-sm text-gray-500">
                      Send notifications to configured webhooks
                    </p>
                  </div>
                </div>
                <Switch
                  checked={preferences.webhookNotifications}
                  onChange={(checked) => setPreferences({ ...preferences, webhookNotifications: checked })}
                  className={`${
                    preferences.webhookNotifications ? 'bg-blue-600' : 'bg-gray-200'
                  } relative inline-flex h-6 w-11 items-center rounded-full`}
                >
                  <span className={`${
                    preferences.webhookNotifications ? 'translate-x-6' : 'translate-x-1'
                  } inline-block h-4 w-4 transform rounded-full bg-white transition`} />
                </Switch>
              </div>
            </div>
          </div>

          {/* Do Not Disturb */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Do Not Disturb
            </h3>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <BellIcon className="h-5 w-5 text-gray-400 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      Enable Do Not Disturb
                    </p>
                    <p className="text-sm text-gray-500">
                      Pause non-urgent notifications during specified hours
                    </p>
                  </div>
                </div>
                <Switch
                  checked={preferences.doNotDisturb}
                  onChange={(checked) => setPreferences({ ...preferences, doNotDisturb: checked })}
                  className={`${
                    preferences.doNotDisturb ? 'bg-blue-600' : 'bg-gray-200'
                  } relative inline-flex h-6 w-11 items-center rounded-full`}
                >
                  <span className={`${
                    preferences.doNotDisturb ? 'translate-x-6' : 'translate-x-1'
                  } inline-block h-4 w-4 transform rounded-full bg-white transition`} />
                </Switch>
              </div>

              {preferences.doNotDisturb && (
                <div className="ml-8 flex items-center space-x-4">
                  <div>
                    <label className="text-sm text-gray-700 dark:text-gray-300">From</label>
                    <input
                      type="time"
                      value={preferences.doNotDisturbTime.start}
                      onChange={(e) => setPreferences({
                        ...preferences,
                        doNotDisturbTime: { ...preferences.doNotDisturbTime, start: e.target.value }
                      })}
                      className="mt-1 block rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-700 dark:text-gray-300">To</label>
                    <input
                      type="time"
                      value={preferences.doNotDisturbTime.end}
                      onChange={(e) => setPreferences({
                        ...preferences,
                        doNotDisturbTime: { ...preferences.doNotDisturbTime, end: e.target.value }
                      })}
                      className="mt-1 block rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Notification Types */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Notification Types
            </h3>
            
            <div className="space-y-6">
              {notificationCategories.map(category => (
                <div key={category.name}>
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    {category.name}
                  </h4>
                  <div className="space-y-3">
                    {category.types.map(({ type, label }) => (
                      <div key={type} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                        <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                          {label}
                        </p>
                        <div className="flex space-x-4">
                          <label className="flex items-center">
                            <input
                              type="checkbox"
                              checked={isChannelEnabled(type, NotificationChannel.WEBSOCKET)}
                              onChange={() => toggleChannel(type, NotificationChannel.WEBSOCKET)}
                              className="rounded border-gray-300"
                            />
                            <span className="ml-2 text-sm text-gray-600 dark:text-gray-300">
                              In-app
                            </span>
                          </label>
                          <label className="flex items-center">
                            <input
                              type="checkbox"
                              checked={isChannelEnabled(type, NotificationChannel.EMAIL)}
                              onChange={() => toggleChannel(type, NotificationChannel.EMAIL)}
                              disabled={!preferences.emailNotifications}
                              className="rounded border-gray-300"
                            />
                            <span className="ml-2 text-sm text-gray-600 dark:text-gray-300">
                              Email
                            </span>
                          </label>
                          <label className="flex items-center">
                            <input
                              type="checkbox"
                              checked={isChannelEnabled(type, NotificationChannel.WEBHOOK)}
                              onChange={() => toggleChannel(type, NotificationChannel.WEBHOOK)}
                              disabled={!preferences.webhookNotifications}
                              className="rounded border-gray-300"
                            />
                            <span className="ml-2 text-sm text-gray-600 dark:text-gray-300">
                              Webhook
                            </span>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Save Button */}
          <div className="pt-4">
            <button
              onClick={savePreferences}
              disabled={saving}
              className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};