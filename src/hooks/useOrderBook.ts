import { useEffect, useState, useRef, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';
import { OrderBookSnapshot, OrderBookUpdate, PriceLevel } from '../services/matchingEngine/types';

export interface OrderBookState {
  bids: PriceLevel[];
  asks: PriceLevel[];
  lastUpdate: number;
  sequence: number;
}

export interface UseOrderBookOptions {
  pair: string;
  depth?: number;
  throttleMs?: number;
}

export const useOrderBook = ({ pair, depth = 20, throttleMs = 100 }: UseOrderBookOptions) => {
  const { subscribe, on, requestSnapshot, state: wsState } = useWebSocket();
  const [orderBook, setOrderBook] = useState<OrderBookState>({
    bids: [],
    asks: [],
    lastUpdate: 0,
    sequence: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const updateQueueRef = useRef<OrderBookUpdate[]>([]);
  const processTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sequenceRef = useRef<number>(0);

  // Process queued updates
  const processUpdateQueue = useCallback(() => {
    if (updateQueueRef.current.length === 0) return;

    setOrderBook(prevState => {
      const updates = updateQueueRef.current;
      updateQueueRef.current = [];

      let newState = { ...prevState };

      for (const update of updates) {
        // Skip old updates
        if (update.sequence <= sequenceRef.current) continue;
        
        sequenceRef.current = update.sequence;

        // Apply updates to order book
        newState = applyUpdate(newState, update);
        newState.lastUpdate = update.timestamp;
        newState.sequence = update.sequence;
      }

      return newState;
    });
  }, []);

  // Apply a single update to the order book
  const applyUpdate = (state: OrderBookState, update: OrderBookUpdate): OrderBookState => {
    const newBids = [...state.bids];
    const newAsks = [...state.asks];

    // Update bids
    for (const [price, quantity] of update.bids) {
      updatePriceLevel(newBids, price, quantity, 'DESC');
    }

    // Update asks
    for (const [price, quantity] of update.asks) {
      updatePriceLevel(newAsks, price, quantity, 'ASC');
    }

    return {
      ...state,
      bids: newBids.slice(0, depth),
      asks: newAsks.slice(0, depth)
    };
  };

  // Update a price level in the order book
  const updatePriceLevel = (
    levels: PriceLevel[],
    price: number,
    quantity: number,
    sortOrder: 'ASC' | 'DESC'
  ) => {
    const index = levels.findIndex(level => level[0] === price);

    if (quantity === 0) {
      // Remove level
      if (index !== -1) {
        levels.splice(index, 1);
      }
    } else {
      if (index !== -1) {
        // Update existing level
        levels[index] = [price, quantity];
      } else {
        // Insert new level
        levels.push([price, quantity]);
        
        // Sort levels
        levels.sort((a, b) => 
          sortOrder === 'DESC' ? b[0] - a[0] : a[0] - b[0]
        );
      }
    }
  };

  // Subscribe to order book updates
  useEffect(() => {
    if (!wsState.connected || !pair) return;

    setLoading(true);
    setError(null);

    const channel = `orderbook:${pair}`;
    const unsubscribe = subscribe(channel, { depth });

    // Handle snapshot
    const unsubSnapshot = on('orderbook:snapshot', (data: any) => {
      if (data.channel === channel) {
        const snapshot: OrderBookSnapshot = data.data;
        
        setOrderBook({
          bids: snapshot.bids.slice(0, depth),
          asks: snapshot.asks.slice(0, depth),
          lastUpdate: data.timestamp,
          sequence: snapshot.sequence || 0
        });
        
        sequenceRef.current = snapshot.sequence || 0;
        setLoading(false);
      }
    });

    // Handle updates
    const unsubUpdate = on('orderbook:update', (data: any) => {
      if (data.channel === channel) {
        updateQueueRef.current.push(data.data);
      }
    });

    // Handle errors
    const unsubError = on('subscription:error', (data: any) => {
      if (data.channel === channel) {
        setError(data.error);
        setLoading(false);
      }
    });

    // Request initial snapshot
    requestSnapshot(channel);

    // Start update processing timer
    processTimerRef.current = setInterval(processUpdateQueue, throttleMs);

    return () => {
      unsubscribe();
      unsubSnapshot();
      unsubUpdate();
      unsubError();
      
      if (processTimerRef.current) {
        clearInterval(processTimerRef.current);
      }
    };
  }, [pair, depth, wsState.connected, subscribe, on, requestSnapshot, processUpdateQueue, throttleMs]);

  // Calculate spread
  const spread = orderBook.asks[0] && orderBook.bids[0]
    ? orderBook.asks[0][0] - orderBook.bids[0][0]
    : 0;

  // Calculate mid price
  const midPrice = orderBook.asks[0] && orderBook.bids[0]
    ? (orderBook.asks[0][0] + orderBook.bids[0][0]) / 2
    : 0;

  return {
    orderBook,
    loading,
    error,
    spread,
    midPrice,
    connected: wsState.connected
  };
};