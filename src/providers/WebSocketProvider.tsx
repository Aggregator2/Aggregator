import React, { createContext, useContext, ReactNode } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

const WebSocketContext = createContext<ReturnType<typeof useWebSocket> | null>(null);

export interface WebSocketProviderProps {
  children: ReactNode;
  url?: string;
  path?: string;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({
  children,
  url,
  path = '/ws'
}) => {
  const websocket = useWebSocket({
    url,
    path,
    autoConnect: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  });

  return (
    <WebSocketContext.Provider value={websocket}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocketContext = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within WebSocketProvider');
  }
  return context;
};