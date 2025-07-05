import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { createHmac } from 'crypto';
import { 
  ApiError, 
  AuthenticationError, 
  RateLimitError, 
  NetworkError,
  TimeoutError,
  RateLimitInfo 
} from '../types/errors';
import { ClientOptions, AuthCredentials, SignedRequest } from '../types';

export class RequestClient {
  private axios: AxiosInstance;
  private apiKey: string;
  private apiSecret?: string;
  private rateLimitInfo: Map<string, RateLimitInfo> = new Map();

  constructor(apiKey: string, options: ClientOptions = {}) {
    this.apiKey = apiKey;
    this.apiSecret = options.headers?.['X-API-SECRET'];
    
    const baseURL = options.testnet 
      ? 'https://api.testnet.offchain.finance'
      : (options.baseUrl || 'https://api.offchain.finance');

    this.axios = axios.create({
      baseURL,
      timeout: options.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
        ...options.headers
      }
    });

    // Request interceptor for signing
    this.axios.interceptors.request.use(
      (config) => this.signRequest(config),
      (error) => Promise.reject(error)
    );

    // Response interceptor for rate limit handling
    this.axios.interceptors.response.use(
      (response) => {
        this.updateRateLimitInfo(response.headers);
        return response;
      },
      (error) => this.handleError(error, options)
    );
  }

  /**
   * Sign request with HMAC-SHA256
   */
  private signRequest(config: AxiosRequestConfig): AxiosRequestConfig {
    if (!this.apiSecret) return config;

    const timestamp = Date.now();
    const nonce = Math.random().toString(36).substring(7);
    
    // Create signature payload
    const method = config.method?.toUpperCase() || 'GET';
    const path = config.url || '';
    const body = config.data ? JSON.stringify(config.data) : '';
    const payload = `${timestamp}${nonce}${method}${path}${body}`;
    
    // Generate signature
    const signature = createHmac('sha256', this.apiSecret)
      .update(payload)
      .digest('hex');

    // Add auth headers
    config.headers = {
      ...config.headers,
      'X-TIMESTAMP': timestamp.toString(),
      'X-NONCE': nonce,
      'X-SIGNATURE': signature
    };

    return config;
  }

  /**
   * Update rate limit info from response headers
   */
  private updateRateLimitInfo(headers: any): void {
    const limit = parseInt(headers['x-ratelimit-limit']);
    const remaining = parseInt(headers['x-ratelimit-remaining']);
    const reset = parseInt(headers['x-ratelimit-reset']);

    if (limit && remaining !== undefined && reset) {
      this.rateLimitInfo.set('global', {
        limit,
        remaining,
        reset: new Date(reset * 1000)
      });
    }
  }

  /**
   * Handle API errors
   */
  private async handleError(error: AxiosError, options: ClientOptions): Promise<never> {
    if (!error.response) {
      // Network error
      if (error.code === 'ECONNABORTED') {
        throw new TimeoutError('Request timeout');
      }
      throw new NetworkError(error.message);
    }

    const { status, data, headers } = error.response;

    // Handle rate limiting
    if (status === 429) {
      const retryAfter = parseInt(headers['retry-after']) || 60;
      
      if (options.rateLimitRetry && options.retryAttempts && options.retryAttempts > 0) {
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return this.axios.request(error.config!);
      }
      
      throw new RateLimitError('Rate limit exceeded', retryAfter, data);
    }

    // Handle authentication errors
    if (status === 401) {
      throw new AuthenticationError(data?.message || 'Authentication failed', data);
    }

    // Handle other API errors
    const errorData = data as any;
    throw new ApiError(
      errorData?.message || 'API request failed',
      errorData?.code || 'API_ERROR',
      status,
      errorData
    );
  }

  /**
   * Make GET request
   */
  async get<T>(path: string, params?: any): Promise<T> {
    const response = await this.axios.get(path, { params });
    return response.data;
  }

  /**
   * Make POST request
   */
  async post<T>(path: string, data?: any): Promise<T> {
    const response = await this.axios.post(path, data);
    return response.data;
  }

  /**
   * Make PUT request
   */
  async put<T>(path: string, data?: any): Promise<T> {
    const response = await this.axios.put(path, data);
    return response.data;
  }

  /**
   * Make DELETE request
   */
  async delete<T>(path: string): Promise<T> {
    const response = await this.axios.delete(path);
    return response.data;
  }

  /**
   * Get current rate limit info
   */
  getRateLimitInfo(): RateLimitInfo | undefined {
    return this.rateLimitInfo.get('global');
  }
}