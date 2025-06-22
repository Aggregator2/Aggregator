import { useState, useEffect, useCallback } from 'react';

interface NetworkStatus {
  isOnline: boolean;
  downlink?: number;
  effectiveType?: string;
  rtt?: number;
  saveData?: boolean;
}

interface FallbackConfig {
  enabled: boolean;
  data?: any;
  message?: string;
}

export function useNetworkStatus(): NetworkStatus {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  });

  useEffect(() => {
    const updateNetworkStatus = () => {
      const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      
      setNetworkStatus({
        isOnline: navigator.onLine,
        downlink: connection?.downlink,
        effectiveType: connection?.effectiveType,
        rtt: connection?.rtt,
        saveData: connection?.saveData,
      });
    };

    updateNetworkStatus();

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (connection) {
      connection.addEventListener('change', updateNetworkStatus);
    }

    return () => {
      window.removeEventListener('online', updateNetworkStatus);
      window.removeEventListener('offline', updateNetworkStatus);
      if (connection) {
        connection.removeEventListener('change', updateNetworkStatus);
      }
    };
  }, []);

  return networkStatus;
}

export function useFallbackData<T>(config: FallbackConfig) {
  const networkStatus = useNetworkStatus();
  const [fallbackActive, setFallbackActive] = useState(false);

  const enableFallback = useCallback(() => {
    if (config.enabled) {
      setFallbackActive(true);
    }
  }, [config.enabled]);

  const disableFallback = useCallback(() => {
    setFallbackActive(false);
  }, []);

  useEffect(() => {
    if (!networkStatus.isOnline && config.enabled) {
      setFallbackActive(true);
    } else if (networkStatus.isOnline && fallbackActive) {
      // Allow manual control when back online
    }
  }, [networkStatus.isOnline, config.enabled, fallbackActive]);

  return {
    fallbackActive,
    fallbackData: config.data,
    fallbackMessage: config.message || 'Using cached data due to connectivity issues',
    enableFallback,
    disableFallback,
    networkStatus,
  };
}

// Gas price fallback hook
export function useGasPriceFallback() {
  const fallbackGasPrices = {
    slow: '20000000000', // 20 gwei
    standard: '25000000000', // 25 gwei
    fast: '30000000000', // 30 gwei
  };

  return useFallbackData({
    enabled: true,
    data: fallbackGasPrices,
    message: 'Using fallback gas prices due to network issues',
  });
}

// Token price fallback hook
export function useTokenPriceFallback() {
  const fallbackPrices = {
    ETH: 2400, // USD
    WETH: 2400,
    DAI: 1,
    USDC: 1,
    USDT: 1,
  };

  return useFallbackData({
    enabled: true,
    data: fallbackPrices,
    message: 'Using approximate token prices due to API limitations',
  });
}
