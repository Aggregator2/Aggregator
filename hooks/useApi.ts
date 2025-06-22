import { useState, useEffect, useCallback } from 'react';

interface UseApiOptions<T> {
  immediate?: boolean;
  retries?: number;
  retryDelay?: number;
  fallbackData?: T;
  timeout?: number;
}

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  retryCount: number;
}

export function useApi<T>(
  apiCall: () => Promise<T>,
  options: UseApiOptions<T> = {}
) {
  const {
    immediate = true,
    retries = 3,
    retryDelay = 1000,
    fallbackData = null,
    timeout = 10000,
  } = options;

  const [state, setState] = useState<ApiState<T>>({
    data: fallbackData,
    loading: false,
    error: null,
    retryCount: 0,
  });

  const withTimeout = useCallback(
    (promise: Promise<T>): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeout)
        ),
      ]);
    },
    [timeout]
  );

  const executeWithRetry = useCallback(
    async (attemptNumber = 0): Promise<void> => {
      setState(prev => ({ 
        ...prev, 
        loading: true, 
        retryCount: attemptNumber,
        error: attemptNumber === 0 ? null : prev.error 
      }));

      try {
        const result = await withTimeout(apiCall());
        setState(prev => ({
          ...prev,
          data: result,
          loading: false,
          error: null,
          retryCount: attemptNumber,
        }));
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Unknown error');
        
        if (attemptNumber < retries) {
          setTimeout(() => executeWithRetry(attemptNumber + 1), retryDelay);
        } else {
          setState(prev => ({
            ...prev,
            loading: false,
            error: err,
            retryCount: attemptNumber,
            data: fallbackData,
          }));
        }
      }
    },
    [apiCall, retries, retryDelay, fallbackData, withTimeout]
  );

  const execute = useCallback(() => {
    executeWithRetry(0);
  }, [executeWithRetry]);

  const reset = useCallback(() => {
    setState({
      data: fallbackData,
      loading: false,
      error: null,
      retryCount: 0,
    });
  }, [fallbackData]);

  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [execute, immediate]);

  return {
    ...state,
    execute,
    reset,
    isRetrying: state.retryCount > 0 && state.loading,
  };
}

// Specialized hook for network requests with better error categorization
export function useApiRequest<T>(
  url: string,
  options: RequestInit & UseApiOptions<T> = {}
) {
  const { immediate, retries, retryDelay, fallbackData, timeout, ...fetchOptions } = options;

  const apiCall = useCallback(async (): Promise<T> => {
    const response = await fetch(url, fetchOptions);
    
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      
      // Try to get more specific error message from response body
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage = errorData.error;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch {
        // Fallback to status text if JSON parsing fails
      }
      
      const error = new Error(errorMessage);
      (error as any).status = response.status;
      (error as any).statusText = response.statusText;
      throw error;
    }
    
    const contentType = response.headers.get('Content-Type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }
    
    return response.text() as any;
  }, [url, fetchOptions]);

  return useApi(apiCall, { immediate, retries, retryDelay, fallbackData, timeout });
}
