// Package swappiq provides HTTP client with automatic retry and rate limiting
// Author: SwappiQ Protocol
// Description: Production-grade HTTP client for Go with comprehensive error handling

package swappiq

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RequestOptions represents options for HTTP requests
type RequestOptions struct {
	Method   string            `json:"method"`
	Path     string            `json:"path"`
	Body     interface{}       `json:"body,omitempty"`
	Headers  map[string]string `json:"headers,omitempty"`
	Auth     bool              `json:"auth"`
	Timeout  *time.Duration    `json:"timeout,omitempty"`
	Retries  *int              `json:"retries,omitempty"`
	Priority string            `json:"priority"` // "low", "normal", "high"
}

// RequestMetrics represents metrics for a request
type RequestMetrics struct {
	RequestID  string        `json:"request_id"`
	Method     string        `json:"method"`
	Path       string        `json:"path"`
	StartTime  time.Time     `json:"start_time"`
	EndTime    time.Time     `json:"end_time"`
	Duration   time.Duration `json:"duration"`
	Status     int           `json:"status"`
	Success    bool          `json:"success"`
	RetryCount int           `json:"retry_count"`
	FromCache  bool          `json:"from_cache"`
}

// HTTPError represents an HTTP-specific error
type HTTPError struct {
	Message string `json:"message"`
	Status  int    `json:"status"`
}

func (e *HTTPError) Error() string {
	return e.Message
}

// TimeoutError represents a request timeout error
type TimeoutError struct {
	Message string `json:"message"`
}

func (e *TimeoutError) Error() string {
	return e.Message
}

// CacheEntry represents a cached response
type CacheEntry struct {
	Response  *APIResponse `json:"response"`
	Timestamp time.Time    `json:"timestamp"`
}

// HTTPClient provides enterprise-grade HTTP client functionality
type HTTPClient struct {
	baseURL       string
	auth          *AuthCredentials
	retryConfig   RetryConfig
	rateLimiter   *RateLimiter
	timeout       time.Duration
	debug         bool
	client        *http.Client
	requestSigner *RequestSigner

	// State management
	responseCache   map[string]*CacheEntry
	activeRequests  map[string]chan *APIResponse
	requestCounter  int64
	metrics         []RequestMetrics
	mutex           sync.RWMutex
}

// NewHTTPClient creates a new HTTP client instance
func NewHTTPClient(config SDKConfig) (*HTTPClient, error) {
	client := &http.Client{
		Timeout: config.Timeout,
		Transport: &http.Transport{
			MaxIdleConns:       100,
			MaxIdleConnsPerHost: 30,
			IdleConnTimeout:    30 * time.Second,
		},
	}

	var rateLimiter *RateLimiter
	if config.RateLimitConfig != nil {
		rateLimiter = NewRateLimiter(*config.RateLimitConfig)
	}

	var requestSigner *RequestSigner
	if config.Auth != nil {
		requestSigner = NewRequestSigner(*config.Auth)
	}

	return &HTTPClient{
		baseURL:        strings.TrimSuffix(config.APIURL, "/"),
		auth:           config.Auth,
		retryConfig:    config.RetryConfig,
		rateLimiter:    rateLimiter,
		timeout:        config.Timeout,
		debug:          config.Debug,
		client:         client,
		requestSigner:  requestSigner,
		responseCache:  make(map[string]*CacheEntry),
		activeRequests: make(map[string]chan *APIResponse),
		metrics:        make([]RequestMetrics, 0),
	}, nil
}

// Request makes a type-safe API request with automatic retry and rate limiting
func (c *HTTPClient) Request(ctx context.Context, options RequestOptions) (*APIResponse, error) {
	requestID := c.generateRequestID()
	startTime := time.Now()

	// Rate limiting check
	if c.rateLimiter != nil {
		if err := c.rateLimiter.Acquire(ctx, options.Priority); err != nil {
			return nil, fmt.Errorf("rate limit: %w", err)
		}
	}

	// Check for duplicate requests
	duplicateKey := c.getDuplicateKey(options)
	if responseChan, exists := c.getActiveRequest(duplicateKey); exists {
		if c.debug {
			fmt.Printf("[%s] Waiting for duplicate request: %s\n", requestID, duplicateKey)
		}
		select {
		case response := <-responseChan:
			return response, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	// Check cache for GET requests
	if options.Method == "GET" {
		if cached := c.getFromCache(options.Path); cached != nil {
			c.recordMetrics(RequestMetrics{
				RequestID:  requestID,
				Method:     options.Method,
				Path:       options.Path,
				StartTime:  startTime,
				EndTime:    time.Now(),
				Duration:   0,
				Status:     200,
				Success:    true,
				RetryCount: 0,
				FromCache:  true,
			})
			return cached, nil
		}
	}

	// Create response channel for duplicate detection
	responseChan := make(chan *APIResponse, 1)
	c.setActiveRequest(duplicateKey, responseChan)
	defer c.removeActiveRequest(duplicateKey)

	// Execute request with retry logic
	response, err := c.executeRequest(ctx, options, requestID, startTime)
	if err != nil {
		c.recordMetrics(RequestMetrics{
			RequestID:  requestID,
			Method:     options.Method,
			Path:       options.Path,
			StartTime:  startTime,
			EndTime:    time.Now(),
			Duration:   time.Since(startTime),
			Status:     0,
			Success:    false,
			RetryCount: 0,
			FromCache:  false,
		})
		return nil, err
	}

	// Cache successful GET responses
	if options.Method == "GET" && response.Success {
		c.cacheResponse(options.Path, response)
	}

	// Send response to waiting goroutines
	select {
	case responseChan <- response:
	default:
	}

	return response, nil
}

// executeRequest executes a request with retry logic
func (c *HTTPClient) executeRequest(ctx context.Context, options RequestOptions, requestID string, startTime time.Time) (*APIResponse, error) {
	var lastError error
	retryCount := 0
	maxRetries := c.retryConfig.MaxAttempts
	if options.Retries != nil {
		maxRetries = *options.Retries
	}

	for retryCount <= maxRetries {
		response, err := c.makeHTTPRequest(ctx, options, requestID)
		if err == nil {
			c.recordMetrics(RequestMetrics{
				RequestID:  requestID,
				Method:     options.Method,
				Path:       options.Path,
				StartTime:  startTime,
				EndTime:    time.Now(),
				Duration:   time.Since(startTime),
				Status:     200,
				Success:    response.Success,
				RetryCount: retryCount,
				FromCache:  false,
			})
			return response, nil
		}

		lastError = err

		if retryCount == maxRetries || !c.isRetryableError(err) {
			break
		}

		retryCount++
		delay := c.calculateRetryDelay(retryCount)

		if c.debug {
			fmt.Printf("[%s] Retry %d/%d after %v: %v\n", requestID, retryCount, maxRetries, delay, err)
		}

		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	c.recordMetrics(RequestMetrics{
		RequestID:  requestID,
		Method:     options.Method,
		Path:       options.Path,
		StartTime:  startTime,
		EndTime:    time.Now(),
		Duration:   time.Since(startTime),
		Status:     0,
		Success:    false,
		RetryCount: retryCount,
		FromCache:  false,
	})

	return nil, lastError
}

// makeHTTPRequest makes the actual HTTP request
func (c *HTTPClient) makeHTTPRequest(ctx context.Context, options RequestOptions, requestID string) (*APIResponse, error) {
	fullURL, err := url.JoinPath(c.baseURL, options.Path)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}

	// Prepare request body
	var bodyReader io.Reader
	var bodyString string
	if options.Body != nil {
		bodyBytes, err := json.Marshal(options.Body)
		if err != nil {
			return nil, fmt.Errorf("marshal body: %w", err)
		}
		bodyString = string(bodyBytes)
		bodyReader = bytes.NewReader(bodyBytes)
	}

	// Create request
	req, err := http.NewRequestWithContext(ctx, strings.ToUpper(options.Method), fullURL, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	// Set headers
	req.Header.Set("User-Agent", "SwappiQ-SDK-Go/1.0.0")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", requestID)

	for key, value := range options.Headers {
		req.Header.Set(key, value)
	}

	// Sign request if authentication is required
	if options.Auth && c.requestSigner != nil {
		timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
		signedRequest, err := c.requestSigner.SignRequest(SignedRequest{
			Method:    strings.ToUpper(options.Method),
			Path:      options.Path,
			Body:      bodyString,
			Timestamp: timestamp,
		})
		if err != nil {
			return nil, fmt.Errorf("sign request: %w", err)
		}

		for key, value := range signedRequest.Headers {
			req.Header.Set(key, value)
		}
	}

	if c.debug {
		fmt.Printf("[%s] %s %s\n", requestID, req.Method, req.URL.String())
	}

	// Set request timeout
	if options.Timeout != nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, *options.Timeout)
		defer cancel()
		req = req.WithContext(ctx)
	}

	// Execute request
	resp, err := c.client.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, &TimeoutError{Message: fmt.Sprintf("request timeout after %v", c.timeout)}
		}
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, &HTTPError{
			Message: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, resp.Status),
			Status:  resp.StatusCode,
		}
	}

	// Parse response
	var responseData APIResponse
	if err := json.NewDecoder(resp.Body).Decode(&responseData); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	// Validate response structure
	if !c.isValidAPIResponse(&responseData) {
		return nil, fmt.Errorf("invalid API response structure")
	}

	if c.debug {
		fmt.Printf("[%s] Response: %+v\n", requestID, c.sanitizeResponse(&responseData))
	}

	return &responseData, nil
}

// calculateRetryDelay calculates exponential backoff delay with jitter
func (c *HTTPClient) calculateRetryDelay(attempt int) time.Duration {
	baseDelay := c.retryConfig.BaseDelay
	backoffFactor := c.retryConfig.BackoffFactor
	maxDelay := c.retryConfig.MaxDelay

	delay := time.Duration(float64(baseDelay) * math.Pow(backoffFactor, float64(attempt-1)))
	if delay > maxDelay {
		delay = maxDelay
	}

	if c.retryConfig.Jitter {
		// Add random jitter ±25%
		jitterAmount := float64(delay) * 0.25
		randomBytes := make([]byte, 8)
		rand.Read(randomBytes)
		jitter := (float64(randomBytes[0])/255.0 - 0.5) * 2 * jitterAmount
		delay = time.Duration(float64(delay) + jitter)
	}

	if delay < 100*time.Millisecond {
		delay = 100 * time.Millisecond // Minimum 100ms delay
	}

	return delay
}

// isRetryableError checks if an error is retryable
func (c *HTTPClient) isRetryableError(err error) bool {
	if _, ok := err.(*TimeoutError); ok {
		return true
	}
	if httpErr, ok := err.(*HTTPError); ok {
		return httpErr.Status >= 500 || httpErr.Status == 429
	}

	errorMessage := strings.ToLower(err.Error())
	for _, retryableError := range c.retryConfig.RetryableErrors {
		if strings.Contains(errorMessage, strings.ToLower(retryableError)) {
			return true
		}
	}

	return false
}

// isValidAPIResponse validates API response structure
func (c *HTTPClient) isValidAPIResponse(data *APIResponse) bool {
	return data.Timestamp.IsZero() == false && data.RequestID != ""
}

// getFromCache retrieves response from cache
func (c *HTTPClient) getFromCache(path string) *APIResponse {
	c.mutex.RLock()
	defer c.mutex.RUnlock()

	cached, exists := c.responseCache[path]
	if !exists {
		return nil
	}

	if time.Since(cached.Timestamp) > 30*time.Second { // 30 second TTL
		delete(c.responseCache, path)
		return nil
	}

	return cached.Response
}

// cacheResponse caches a response
func (c *HTTPClient) cacheResponse(path string, response *APIResponse) {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	c.responseCache[path] = &CacheEntry{
		Response:  response,
		Timestamp: time.Now(),
	}
}

// generateRequestID generates a unique request ID
func (c *HTTPClient) generateRequestID() string {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	c.requestCounter++
	randomBytes := make([]byte, 4)
	rand.Read(randomBytes)
	return fmt.Sprintf("req_%d_%d_%x", time.Now().UnixMilli(), c.requestCounter, randomBytes)
}

// getDuplicateKey gets key for duplicate request detection
func (c *HTTPClient) getDuplicateKey(options RequestOptions) string {
	bodyHash := ""
	if options.Body != nil {
		bodyBytes, _ := json.Marshal(options.Body)
		bodyHash = fmt.Sprintf("%x", bodyBytes)
	}
	return fmt.Sprintf("%s:%s:%s", options.Method, options.Path, bodyHash)
}

// getActiveRequest retrieves active request channel
func (c *HTTPClient) getActiveRequest(key string) (chan *APIResponse, bool) {
	c.mutex.RLock()
	defer c.mutex.RUnlock()
	
	ch, exists := c.activeRequests[key]
	return ch, exists
}

// setActiveRequest sets active request channel
func (c *HTTPClient) setActiveRequest(key string, ch chan *APIResponse) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	
	c.activeRequests[key] = ch
}

// removeActiveRequest removes active request channel
func (c *HTTPClient) removeActiveRequest(key string) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	
	delete(c.activeRequests, key)
}

// recordMetrics records request metrics
func (c *HTTPClient) recordMetrics(metrics RequestMetrics) {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	c.metrics = append(c.metrics, metrics)

	// Keep only last 1000 metrics
	if len(c.metrics) > 1000 {
		c.metrics = c.metrics[len(c.metrics)-1000:]
	}
}

// sanitizeResponse sanitizes response for logging
func (c *HTTPClient) sanitizeResponse(response *APIResponse) *APIResponse {
	sanitized := *response
	// Remove sensitive data if present
	if data, ok := response.Data.(map[string]interface{}); ok {
		sanitizedData := make(map[string]interface{})
		for k, v := range data {
			if strings.Contains(strings.ToLower(k), "secret") ||
			   strings.Contains(strings.ToLower(k), "private") ||
			   strings.Contains(strings.ToLower(k), "password") ||
			   strings.Contains(strings.ToLower(k), "signature") {
				sanitizedData[k] = "[REDACTED]"
			} else {
				sanitizedData[k] = v
			}
		}
		sanitized.Data = sanitizedData
	}
	return &sanitized
}

// GetStats returns client statistics
func (c *HTTPClient) GetStats() map[string]interface{} {
	c.mutex.RLock()
	defer c.mutex.RUnlock()

	now := time.Now()
	recentMetrics := make([]RequestMetrics, 0)
	for _, m := range c.metrics {
		if now.Sub(m.EndTime) < time.Hour { // Last hour
			recentMetrics = append(recentMetrics, m)
		}
	}

	successfulRequests := 0
	totalDuration := time.Duration(0)
	cacheHits := 0

	for _, m := range recentMetrics {
		if m.Success {
			successfulRequests++
		}
		totalDuration += m.Duration
		if m.FromCache {
			cacheHits++
		}
	}

	totalRequests := len(recentMetrics)
	successRate := float64(successfulRequests) / math.Max(float64(totalRequests), 1)
	avgResponseTime := float64(totalDuration) / math.Max(float64(totalRequests), 1) / float64(time.Millisecond)
	cacheHitRate := float64(cacheHits) / math.Max(float64(totalRequests), 1)

	stats := map[string]interface{}{
		"total_requests":       totalRequests,
		"successful_requests":  successfulRequests,
		"failed_requests":      totalRequests - successfulRequests,
		"success_rate":         successRate,
		"average_response_time": avgResponseTime,
		"cache_hit_rate":       cacheHitRate,
		"active_cache_entries": len(c.responseCache),
		"active_requests":      len(c.activeRequests),
	}

	if c.rateLimiter != nil {
		stats["rate_limiter_stats"] = c.rateLimiter.GetStats()
	}

	return stats
}

// IsHealthy checks if client is healthy
func (c *HTTPClient) IsHealthy() bool {
	stats := c.GetStats()
	successRate := stats["success_rate"].(float64)
	avgResponseTime := stats["average_response_time"].(float64)
	activeRequests := stats["active_requests"].(int)

	return successRate > 0.95 && avgResponseTime < 5000 && activeRequests < 50
}

// Close cleans up client resources
func (c *HTTPClient) Close() error {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	// Close all active request channels
	for _, ch := range c.activeRequests {
		close(ch)
	}
	c.activeRequests = make(map[string]chan *APIResponse)

	// Clear cache and metrics
	c.responseCache = make(map[string]*CacheEntry)
	c.metrics = make([]RequestMetrics, 0)

	if c.rateLimiter != nil {
		return c.rateLimiter.Close()
	}

	return nil
}