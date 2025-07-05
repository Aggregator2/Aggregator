import React, { useState, useEffect } from 'react';
import { 
  NotificationChannel,
  NotificationEvent,
  NotificationPreferences as INotificationPreferences
} from '../src/types/notifications';

interface NotificationPreferencesProps {
  userId: string;
}

interface PreferenceState {
  [NotificationChannel.EMAIL]: ChannelPreferences;
  [NotificationChannel.WEBHOOK]: ChannelPreferences;
  [NotificationChannel.SMS]: ChannelPreferences;
}

interface ChannelPreferences extends Partial<INotificationPreferences> {
  enabled: boolean;
}

const eventLabels: Record<string, string> = {
  orderCreated: 'Order Created',
  orderFilled: 'Order Filled',
  orderPartiallyFilled: 'Order Partially Filled',
  orderCancelled: 'Order Cancelled',
  orderRejected: 'Order Rejected',
  tradeExecuted: 'Trade Executed',
  settlementCompleted: 'Settlement Completed',
  depositReceived: 'Deposit Received',
  withdrawalCompleted: 'Withdrawal Completed'
};

export const NotificationPreferences: React.FC<NotificationPreferencesProps> = ({ userId }) => {
  const [preferences, setPreferences] = useState<PreferenceState>({
    [NotificationChannel.EMAIL]: { enabled: false },
    [NotificationChannel.WEBHOOK]: { enabled: false },
    [NotificationChannel.SMS]: { enabled: false }
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Load preferences
  useEffect(() => {
    loadPreferences();
  }, [userId]);

  const loadPreferences = async () => {
    setLoading(true);
    try {
      // Load preferences for each channel
      const channels = [NotificationChannel.EMAIL, NotificationChannel.WEBHOOK, NotificationChannel.SMS];
      const loadedPrefs: PreferenceState = {} as PreferenceState;

      for (const channel of channels) {
        const response = await fetch(`/api/notifications/preferences?userId=${userId}&channel=${channel}`);
        const data = await response.json();
        
        if (Array.isArray(data) && data.length > 0) {
          loadedPrefs[channel] = data[0];
        } else {
          // Default preferences
          loadedPrefs[channel] = {
            enabled: false,
            orderCreated: true,
            orderFilled: true,
            orderPartiallyFilled: true,
            orderCancelled: true,
            orderRejected: false,
            tradeExecuted: true,
            settlementCompleted: true,
            depositReceived: true,
            withdrawalCompleted: true
          };
        }
      }

      setPreferences(loadedPrefs);
    } catch (error) {
      console.error('Failed to load preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateChannelPreference = (
    channel: NotificationChannel,
    field: string,
    value: boolean | string
  ) => {
    setPreferences(prev => ({
      ...prev,
      [channel]: {
        ...prev[channel],
        [field]: value
      }
    }));
  };

  const savePreferences = async () => {
    setSaving(true);
    try {
      for (const [channel, prefs] of Object.entries(preferences)) {
        await fetch('/api/notifications/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            channel,
            ...prefs
          })
        });
      }
      
      // Show success message
      alert('Preferences saved successfully!');
    } catch (error) {
      console.error('Failed to save preferences:', error);
      alert('Failed to save preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const testWebhook = async () => {
    const webhookPrefs = preferences[NotificationChannel.WEBHOOK];
    if (!webhookPrefs.webhookUrl) {
      setWebhookTestResult({
        success: false,
        message: 'Please enter a webhook URL'
      });
      return;
    }

    setTestingWebhook(true);
    setWebhookTestResult(null);

    try {
      const response = await fetch('/api/notifications/webhook-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          webhookUrl: webhookPrefs.webhookUrl,
          secret: webhookPrefs.webhookSecret
        })
      });

      const result = await response.json();
      
      setWebhookTestResult({
        success: result.success,
        message: result.success 
          ? `Webhook test successful! (${result.duration}ms)`
          : `Webhook test failed: ${result.error || 'Unknown error'}`
      });
    } catch (error) {
      setWebhookTestResult({
        success: false,
        message: 'Failed to test webhook'
      });
    } finally {
      setTestingWebhook(false);
    }
  };

  if (loading) {
    return <div className="p-4">Loading preferences...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">Notification Preferences</h2>

      {/* Email Notifications */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Email Notifications</h3>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={preferences[NotificationChannel.EMAIL].enabled}
              onChange={(e) => updateChannelPreference(NotificationChannel.EMAIL, 'enabled', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {preferences[NotificationChannel.EMAIL].enabled && (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Email Address</label>
              <input
                type="email"
                value={preferences[NotificationChannel.EMAIL].emailAddress || ''}
                onChange={(e) => updateChannelPreference(NotificationChannel.EMAIL, 'emailAddress', e.target.value)}
                placeholder="your@email.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium mb-2">Event Subscriptions</p>
              {Object.entries(eventLabels).map(([key, label]) => (
                <label key={key} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={preferences[NotificationChannel.EMAIL][key] ?? true}
                    onChange={(e) => updateChannelPreference(NotificationChannel.EMAIL, key, e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Webhook Notifications */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Webhook Notifications</h3>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={preferences[NotificationChannel.WEBHOOK].enabled}
              onChange={(e) => updateChannelPreference(NotificationChannel.WEBHOOK, 'enabled', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {preferences[NotificationChannel.WEBHOOK].enabled && (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Webhook URL</label>
              <input
                type="url"
                value={preferences[NotificationChannel.WEBHOOK].webhookUrl || ''}
                onChange={(e) => updateChannelPreference(NotificationChannel.WEBHOOK, 'webhookUrl', e.target.value)}
                placeholder="https://your-server.com/webhook"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Webhook Secret (optional)</label>
              <input
                type="password"
                value={preferences[NotificationChannel.WEBHOOK].webhookSecret || ''}
                onChange={(e) => updateChannelPreference(NotificationChannel.WEBHOOK, 'webhookSecret', e.target.value)}
                placeholder="Your webhook secret"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Used to sign webhook payloads with HMAC-SHA256</p>
            </div>

            <div className="mb-4">
              <button
                onClick={testWebhook}
                disabled={testingWebhook}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                {testingWebhook ? 'Testing...' : 'Test Webhook'}
              </button>
              
              {webhookTestResult && (
                <div className={`mt-2 p-2 rounded ${webhookTestResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {webhookTestResult.message}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium mb-2">Event Subscriptions</p>
              {Object.entries(eventLabels).map(([key, label]) => (
                <label key={key} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={preferences[NotificationChannel.WEBHOOK][key] ?? true}
                    onChange={(e) => updateChannelPreference(NotificationChannel.WEBHOOK, key, e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {/* SMS Notifications */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">SMS Notifications</h3>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={preferences[NotificationChannel.SMS].enabled}
              onChange={(e) => updateChannelPreference(NotificationChannel.SMS, 'enabled', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {preferences[NotificationChannel.SMS].enabled && (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Phone Number</label>
              <input
                type="tel"
                value={preferences[NotificationChannel.SMS].phoneNumber || ''}
                onChange={(e) => updateChannelPreference(NotificationChannel.SMS, 'phoneNumber', e.target.value)}
                placeholder="+1234567890"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium mb-2">Event Subscriptions (SMS)</p>
              <p className="text-xs text-gray-500 mb-2">Note: SMS notifications are limited to critical events only</p>
              {['orderFilled', 'settlementCompleted', 'depositReceived', 'withdrawalCompleted'].map((key) => (
                <label key={key} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={preferences[NotificationChannel.SMS][key] ?? true}
                    onChange={(e) => updateChannelPreference(NotificationChannel.SMS, key, e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm">{eventLabels[key]}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Additional Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4">Additional Settings</h3>

        <div className="space-y-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={preferences[NotificationChannel.EMAIL].batchNotifications ?? false}
              onChange={(e) => updateChannelPreference(NotificationChannel.EMAIL, 'batchNotifications', e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm">Batch email notifications</span>
          </label>

          {preferences[NotificationChannel.EMAIL].batchNotifications && (
            <div className="ml-6">
              <label className="block text-sm font-medium mb-2">Batch interval (minutes)</label>
              <input
                type="number"
                min="5"
                max="60"
                value={preferences[NotificationChannel.EMAIL].batchIntervalMinutes || 5}
                onChange={(e) => updateChannelPreference(NotificationChannel.EMAIL, 'batchIntervalMinutes', parseInt(e.target.value))}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={preferences[NotificationChannel.EMAIL].quietHoursEnabled ?? false}
              onChange={(e) => updateChannelPreference(NotificationChannel.EMAIL, 'quietHoursEnabled', e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm">Enable quiet hours</span>
          </label>

          {preferences[NotificationChannel.EMAIL].quietHoursEnabled && (
            <div className="ml-6 space-y-2">
              <div>
                <label className="block text-sm font-medium mb-2">Start time</label>
                <input
                  type="time"
                  value={preferences[NotificationChannel.EMAIL].quietHoursStart || '22:00'}
                  onChange={(e) => updateChannelPreference(NotificationChannel.EMAIL, 'quietHoursStart', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">End time</label>
                <input
                  type="time"
                  value={preferences[NotificationChannel.EMAIL].quietHoursEnd || '08:00'}
                  onChange={(e) => updateChannelPreference(NotificationChannel.EMAIL, 'quietHoursEnd', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={savePreferences}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>
    </div>
  );
};