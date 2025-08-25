import { useState, useEffect, useCallback } from "react";

interface TokenPriceData {
  price: number | null;
  loading: boolean;
  error: string | null;
  timestamp: number;
}

interface TokenPriceSubscriber {
  id: string;
  callback: (data: TokenPriceData) => void;
}

// Singleton class to manage token price fetching
class TokenPriceManager {
  private static instance: TokenPriceManager;
  private priceData: Map<string, TokenPriceData> = new Map();
  private subscribers: Map<string, TokenPriceSubscriber[]> = new Map();
  private fetchTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private ongoingRequests: Map<string, Promise<any>> = new Map();
  
  private readonly CACHE_TTL = 60 * 1000; // 60 seconds
  private readonly DEBOUNCE_DELAY = 1000; // 1 second

  static getInstance(): TokenPriceManager {
    if (!TokenPriceManager.instance) {
      TokenPriceManager.instance = new TokenPriceManager();
    }
    return TokenPriceManager.instance;
  }

  subscribe(tokenAddress: string, subscriber: TokenPriceSubscriber): () => void {
    if (!this.subscribers.has(tokenAddress)) {
      this.subscribers.set(tokenAddress, []);
    }
    
    const subs = this.subscribers.get(tokenAddress)!;
    subs.push(subscriber);

    // Immediately notify with cached data if available
    const cached = this.priceData.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      subscriber.callback(cached);
    } else {
      // Schedule a fetch if not already scheduled
      this.scheduleFetch(tokenAddress);
    }

    // Return unsubscribe function
    return () => {
      const index = subs.findIndex(s => s.id === subscriber.id);
      if (index >= 0) {
        subs.splice(index, 1);
      }
      if (subs.length === 0) {
        this.subscribers.delete(tokenAddress);
        // Cancel any pending fetch if no subscribers
        const timeout = this.fetchTimeouts.get(tokenAddress);
        if (timeout) {
          clearTimeout(timeout);
          this.fetchTimeouts.delete(tokenAddress);
        }
      }
    };
  }

  private scheduleFetch(tokenAddress: string) {
    // Clear existing timeout
    const existingTimeout = this.fetchTimeouts.get(tokenAddress);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      this.fetchPrice(tokenAddress);
      this.fetchTimeouts.delete(tokenAddress);
    }, this.DEBOUNCE_DELAY);
    
    this.fetchTimeouts.set(tokenAddress, timeout);
  }

  private async fetchPrice(tokenAddress: string) {
    // Check cache first
    const cached = this.priceData.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return;
    }

    // Check if already fetching
    if (this.ongoingRequests.has(tokenAddress)) {
      return await this.ongoingRequests.get(tokenAddress);
    }

    // Notify subscribers that loading started
    this.notifySubscribers(tokenAddress, {
      price: cached?.price || null,
      loading: true,
      error: null,
      timestamp: Date.now()
    });

    const fetchPromise = this.performFetch(tokenAddress);
    this.ongoingRequests.set(tokenAddress, fetchPromise);

    try {
      const result = await fetchPromise;
      const data: TokenPriceData = {
        price: result.price,
        loading: false,
        error: result.error || null,
        timestamp: Date.now()
      };

      this.priceData.set(tokenAddress, data);
      this.notifySubscribers(tokenAddress, data);
    } catch (error) {
      // Don't treat abort errors as failures
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was cancelled, keep the cached data if available
        if (cached) {
          this.notifySubscribers(tokenAddress, cached);
        }
      } else {
        const errorData: TokenPriceData = {
          price: cached?.price || null,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch price',
          timestamp: Date.now()
        };

        this.priceData.set(tokenAddress, errorData);
        this.notifySubscribers(tokenAddress, errorData);
      }
    } finally {
      this.ongoingRequests.delete(tokenAddress);
    }
  }

  private async performFetch(tokenAddress: string): Promise<{ price: number; error?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`/api/tokenPrice?tokenAddress=${encodeURIComponent(tokenAddress)}`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return { price: data.price, error: data.error };
    } catch (error) {
      clearTimeout(timeoutId);
      // Re-throw AbortError so it can be handled properly upstream
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      // For other errors, wrap them nicely
      throw new Error(error instanceof Error ? error.message : 'Network error');
    }
  }

  private notifySubscribers(tokenAddress: string, data: TokenPriceData) {
    const subscribers = this.subscribers.get(tokenAddress);
    if (subscribers) {
      subscribers.forEach(sub => sub.callback(data));
    }
  }

  // Method to force refresh a token price
  refreshPrice(tokenAddress: string) {
    this.priceData.delete(tokenAddress);
    this.scheduleFetch(tokenAddress);
  }
}

// Hook that uses the singleton manager
export function useTokenPrice(contractAddress: string | null) {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const manager = TokenPriceManager.getInstance();

  useEffect(() => {
    if (!contractAddress) {
      setPrice(null);
      setLoading(false);
      setError(null);
      setRetryCount(0);
      return;
    }

    const subscriberId = Math.random().toString(36);
    
    const unsubscribe = manager.subscribe(contractAddress, {
      id: subscriberId,
      callback: (data) => {
        setPrice(data.price);
        setLoading(data.loading);
        setError(data.error);
      }
    });

    return unsubscribe;
  }, [contractAddress, manager]);

  const retry = useCallback(() => {
    if (contractAddress) {
      setError(null);
      setRetryCount(prev => prev + 1);
      manager.refreshPrice(contractAddress);
    }
  }, [contractAddress, manager]);

  return { 
    price, 
    loading, 
    error, 
    retry, 
    retryCount,
    usingFallback: false // Simplified for now
  };
}