import { authMiddleware } from '../../../utils/auth';
import SuspiciousActivityDetector from '../../../monitoring/suspicious-activity-detector';

// Store detector instance (in production, use proper state management)
let detector = null;

export default async function handler(req, res) {
  // Apply authentication
  const authResult = await authMiddleware(req, res);
  if (!authResult) return;

  // Initialize detector if needed
  if (!detector) {
    detector = new SuspiciousActivityDetector();
  }

  if (req.method === 'GET') {
    try {
      const { 
        limit = 100,
        severity,
        type,
        userId,
        startTime,
        endTime,
        status = 'all'
      } = req.query;

      // Get alerts
      let alerts = detector.getRecentAlerts(parseInt(limit));

      // Apply filters
      if (severity) {
        alerts = alerts.filter(a => a.severity === severity);
      }

      if (type) {
        alerts = alerts.filter(a => a.type === type);
      }

      if (userId) {
        alerts = alerts.filter(a => a.userId === userId);
      }

      if (startTime) {
        alerts = alerts.filter(a => a.timestamp >= parseInt(startTime));
      }

      if (endTime) {
        alerts = alerts.filter(a => a.timestamp <= parseInt(endTime));
      }

      if (status !== 'all') {
        alerts = alerts.filter(a => a.status === status);
      }

      // Get statistics
      const stats = getAlertStatistics(alerts);

      res.status(200).json({
        success: true,
        timestamp: Date.now(),
        data: {
          alerts,
          stats,
          total: alerts.length
        }
      });

    } catch (error) {
      console.error('Alerts API error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve alerts',
        message: error.message
      });
    }

  } else if (req.method === 'POST') {
    // Update alert status or add notes
    try {
      const { alertId, action, notes } = req.body;

      if (!alertId || !action) {
        return res.status(400).json({
          success: false,
          error: 'alertId and action are required'
        });
      }

      let result;

      switch (action) {
        case 'acknowledge':
          result = await acknowledgeAlert(alertId, authResult.userId, notes);
          break;

        case 'resolve':
          result = await resolveAlert(alertId, authResult.userId, notes);
          break;

        case 'escalate':
          result = await escalateAlert(alertId, authResult.userId, notes);
          break;

        case 'dismiss':
          result = await dismissAlert(alertId, authResult.userId, notes);
          break;

        default:
          return res.status(400).json({
            success: false,
            error: 'Invalid action'
          });
      }

      res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Alert update error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update alert',
        message: error.message
      });
    }

  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

function getAlertStatistics(alerts) {
  const stats = {
    total: alerts.length,
    bySeverity: {},
    byType: {},
    byStatus: {},
    recentHour: 0,
    recentDay: 0
  };

  const now = Date.now();
  const hourAgo = now - 3600000;
  const dayAgo = now - 86400000;

  for (const alert of alerts) {
    // By severity
    stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;

    // By type
    stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1;

    // By status
    stats.byStatus[alert.status || 'new'] = (stats.byStatus[alert.status || 'new'] || 0) + 1;

    // Recent counts
    if (alert.timestamp > hourAgo) stats.recentHour++;
    if (alert.timestamp > dayAgo) stats.recentDay++;
  }

  return stats;
}

async function acknowledgeAlert(alertId, userId, notes) {
  // Find and update alert
  const alert = findAlert(alertId);
  if (!alert) {
    throw new Error('Alert not found');
  }

  alert.status = 'acknowledged';
  alert.acknowledgedBy = userId;
  alert.acknowledgedAt = Date.now();
  if (notes) {
    alert.notes = alert.notes || [];
    alert.notes.push({
      timestamp: Date.now(),
      user: userId,
      text: notes
    });
  }

  return alert;
}

async function resolveAlert(alertId, userId, notes) {
  const alert = findAlert(alertId);
  if (!alert) {
    throw new Error('Alert not found');
  }

  alert.status = 'resolved';
  alert.resolvedBy = userId;
  alert.resolvedAt = Date.now();
  if (notes) {
    alert.notes = alert.notes || [];
    alert.notes.push({
      timestamp: Date.now(),
      user: userId,
      text: notes
    });
  }

  return alert;
}

async function escalateAlert(alertId, userId, notes) {
  const alert = findAlert(alertId);
  if (!alert) {
    throw new Error('Alert not found');
  }

  alert.status = 'escalated';
  alert.escalatedBy = userId;
  alert.escalatedAt = Date.now();
  
  // Increase severity
  const severityLevels = ['low', 'medium', 'high', 'critical'];
  const currentIndex = severityLevels.indexOf(alert.severity);
  if (currentIndex < severityLevels.length - 1) {
    alert.severity = severityLevels[currentIndex + 1];
  }

  if (notes) {
    alert.notes = alert.notes || [];
    alert.notes.push({
      timestamp: Date.now(),
      user: userId,
      text: notes
    });
  }

  // Trigger escalation notifications (implement based on your notification system)
  // await notifyEscalation(alert);

  return alert;
}

async function dismissAlert(alertId, userId, notes) {
  const alert = findAlert(alertId);
  if (!alert) {
    throw new Error('Alert not found');
  }

  alert.status = 'dismissed';
  alert.dismissedBy = userId;
  alert.dismissedAt = Date.now();
  if (notes) {
    alert.notes = alert.notes || [];
    alert.notes.push({
      timestamp: Date.now(),
      user: userId,
      text: notes
    });
  }

  return alert;
}

function findAlert(alertId) {
  // In production, this would query from database
  // For now, search in detector's alerts
  return detector.alerts.find(a => a.id === alertId);
}