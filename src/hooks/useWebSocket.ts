import { useRef, useState, useCallback } from 'react';
import { IncomingMessage } from '../types';

interface UseWebSocketReturn {
  isConnected: boolean;
  connect: () => Promise<boolean>;
  sendMessage: (message: unknown) => void;
  disconnect: () => void;
}

export function useWebSocket(onMessage: (message: IncomingMessage) => void): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback((): Promise<boolean> => {
    return new Promise((resolve, reject) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log('✅ WebSocket already connected');
        resolve(true);
        return;
      }

      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:5001/ws';
      const ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        console.error('❌ WebSocket connection timeout');
        ws.close();
        reject(new Error('Connection timeout'));
      }, 5000);

      ws.onopen = () => {
        console.log('✅ WebSocket connected');
        clearTimeout(timeout);
        setIsConnected(true);
        resolve(true);
      };

      ws.onmessage = (event) => {
        try {
          const data: IncomingMessage = JSON.parse(event.data);
          onMessage(data);
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        clearTimeout(timeout);
        setIsConnected(false);
        reject(error);
      };

      ws.onclose = () => {
        console.log('🔌 WebSocket closed');
        clearTimeout(timeout);
        setIsConnected(false);
      };

      wsRef.current = ws;
    });
  }, [onMessage]);

  const sendMessage = useCallback((message: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  return { isConnected, connect, sendMessage, disconnect };
}
