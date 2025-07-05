import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './useAuth';

export interface WebSocketConfig {
  url?: string;
  path?: string;
  autoConnect?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
}

export interface WebSocketState {
  connected: boolean;
  authenticated: boolean;
  error: string | null;
  latency: number;
}

export interface Subscription {
  channel: string;
  params?: any;
}

export const useWebSocket = (config: WebSocketConfig = {}) => {
  const { user, token } = useAuth();
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    authenticated: false,
    error: null,
    latency: 0
  });

  const socketRef = useRef<Socket | null>(null);
  const subscriptionsRef = useRef<Map<string, Subscription>>(new Map());
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPingRef = useRef<number>(0);

  // Initialize socket connection
  useEffect(() => {
    if (!config.autoConnect && config.autoConnect !== undefined) {
      return;
    }

    const socket = io(config.url || window.location.origin, {
      path: config.path || '/ws',
      transports: ['websocket'],
      auth: token ? { token } : undefined,
      reconnectionAttempts: config.reconnectionAttempts || 5,
      reconnectionDelay: config.reconnectionDelay || 1000,
      reconnectionDelayMax: 5000
    });

    socketRef.current = socket;

    // Connection handlers
    socket.on('connect', () => {
      setState(prev => ({ ...prev, connected: true, error: null }));
      
      // Resubscribe to channels
      subscriptionsRef.current.forEach((sub) => {
        socket.emit('subscribe', sub);
      });
    });

    socket.on('disconnect', () => {
      setState(prev => ({ ...prev, connected: false, authenticated: false }));
    });

    socket.on('connect_error', (error) => {
      setState(prev => ({ ...prev, error: error.message }));
    });

    socket.on('authenticated', ({ success }) => {
      setState(prev => ({ ...prev, authenticated: success }));
    });

    socket.on('error', ({ message }) => {
      setState(prev => ({ ...prev, error: message }));
    });

    // Ping/pong for latency measurement
    socket.on('pong', ({ serverTime }) => {
      const latency = Date.now() - lastPingRef.current;
      setState(prev => ({ ...prev, latency }));
    });

    // Start ping interval
    pingIntervalRef.current = setInterval(() => {
      if (socket.connected) {
        lastPingRef.current = Date.now();
        socket.emit('ping');
      }
    }, 30000);

    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      socket.disconnect();
    };
  }, [config.url, config.path, config.autoConnect, token]);

  // Subscribe to a channel
  const subscribe = useCallback((channel: string, params?: any): (() => void) => {
    const socket = socketRef.current;
    if (!socket) return () => {};

    const subscription: Subscription = { channel, params };
    subscriptionsRef.current.set(channel, subscription);

    if (socket.connected) {
      socket.emit('subscribe', subscription);
    }

    // Return unsubscribe function
    return () => {
      subscriptionsRef.current.delete(channel);
      if (socket.connected) {
        socket.emit('unsubscribe', { channel });
      }
    };
  }, []);

  // Send a message
  const send = useCallback((event: string, data: any) => {
    const socket = socketRef.current;
    if (socket && socket.connected) {
      socket.emit(event, data);
    }
  }, []);

  // Request a snapshot
  const requestSnapshot = useCallback((channel: string) => {
    const socket = socketRef.current;
    if (socket && socket.connected) {
      socket.emit('snapshot', { channel });
    }
  }, []);

  // Add event listener
  const on = useCallback((event: string, handler: (data: any) => void): (() => void) => {
    const socket = socketRef.current;
    if (!socket) return () => {};

    socket.on(event, handler);
    
    return () => {
      socket.off(event, handler);
    };
  }, []);

  // Reconnect manually
  const reconnect = useCallback(() => {
    const socket = socketRef.current;
    if (socket && !socket.connected) {
      socket.connect();
    }
  }, []);

  // Disconnect manually
  const disconnect = useCallback(() => {
    const socket = socketRef.current;
    if (socket && socket.connected) {
      socket.disconnect();
    }
  }, []);

  return {
    state,
    subscribe,
    send,
    requestSnapshot,
    on,
    reconnect,
    disconnect,
    socket: socketRef.current
  };
};