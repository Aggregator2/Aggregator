// Package swappiq provides rate limiting functionality with priority queues
// Author: SwappiQ Protocol
// Description: Production-grade rate limiting for API clients with burst handling and fair queuing

package swappiq

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"
)

// Priority represents request priority levels
type Priority string

const (
	PriorityLow    Priority = "low"
	PriorityNormal Priority = "normal"
	PriorityHigh   Priority = "high"
)

// RateLimitInfo represents rate limit information
type RateLimitInfo struct {
	Allowed       bool      `json:"allowed"`
	Remaining     int       `json:"remaining"`
	ResetTime     time.Time `json:"reset_time"`
	RetryAfter    *float64  `json:"retry_after,omitempty"`
	QueuePosition *int      `json:"queue_position,omitempty"`
}

// QueuedRequest represents a queued request
type QueuedRequest struct {
	Priority  Priority           `json:"priority"`
	Done      chan RateLimitInfo `json:"-"`
	Timestamp time.Time          `json:"timestamp"`
	Context   context.Context    `json:"-"`
}

// RateLimiterStats represents rate limiter statistics
type RateLimiterStats struct {
	RequestsPerSecond  int                    `json:"requests_per_second"`
	BurstSize          int                    `json:"burst_size"`
	CurrentTokens      float64                `json:"current_tokens"`
	QueueSize          int                    `json:"queue_size"`
	QueuedByPriority   map[string]int         `json:"queued_by_priority"`
	TotalProcessed     int64                  `json:"total_processed"`
	TotalQueued        int64                  `json:"total_queued"`
	TotalRejected      int64                  `json:"total_rejected"`
	AverageWaitTime    float64                `json:"average_wait_time"`
}

// RateLimiter provides token bucket rate limiting with priority queues
type RateLimiter struct {
	requestsPerSecond int
	burstSize         int
	queueSize         int
	refillInterval    time.Duration

	// Token bucket state
	currentTokens float64
	lastRefill    time.Time
	mutex         sync.RWMutex

	// Priority queues
	requestQueues map[Priority][]*QueuedRequest
	queueMutex    sync.Mutex

	// Statistics
	totalProcessed int64
	totalQueued    int64
	totalRejected  int64
	waitTimes      []time.Duration
	waitTimesMutex sync.Mutex

	// Background processing
	stopChan chan struct{}
	wg       sync.WaitGroup
}

// NewRateLimiter creates a new rate limiter instance
func NewRateLimiter(config RateLimitConfig) *RateLimiter {
	rl := &RateLimiter{
		requestsPerSecond: config.RequestsPerSecond,
		burstSize:         config.BurstSize,
		queueSize:         config.QueueSize,
		refillInterval:    time.Second / time.Duration(config.RequestsPerSecond),
		currentTokens:     float64(config.BurstSize),
		lastRefill:        time.Now(),
		requestQueues: map[Priority][]*QueuedRequest{
			PriorityHigh:   make([]*QueuedRequest, 0),
			PriorityNormal: make([]*QueuedRequest, 0),
			PriorityLow:    make([]*QueuedRequest, 0),
		},
		waitTimes: make([]time.Duration, 0, 1000),
		stopChan:  make(chan struct{}),
	}

	// Start background processing
	rl.wg.Add(2)
	go rl.refillLoop()
	go rl.processQueue()

	return rl
}

// Acquire attempts to acquire a token for making a request
func (rl *RateLimiter) Acquire(ctx context.Context, priority string) error {
	p := Priority(priority)
	if p == "" {
		p = PriorityNormal
	}

	// Try immediate acquisition
	if info := rl.tryImmediateAcquisition(); info.Allowed {
		rl.incrementProcessed()
		return nil
	}

	// Check queue capacity
	if rl.getTotalQueueSize() >= rl.queueSize {
		rl.incrementRejected()
		return fmt.Errorf("rate limit queue is full")
	}

	// Queue the request
	request := &QueuedRequest{
		Priority:  p,
		Done:      make(chan RateLimitInfo, 1),
		Timestamp: time.Now(),
		Context:   ctx,
	}

	rl.enqueueRequest(request)
	rl.incrementQueued()

	// Wait for token or context cancellation
	select {
	case info := <-request.Done:
		if !info.Allowed {
			return fmt.Errorf("rate limit acquisition failed")
		}
		return nil
	case <-ctx.Done():
		rl.removeFromQueue(request)
		return ctx.Err()
	}
}

// tryImmediateAcquisition attempts to acquire a token immediately
func (rl *RateLimiter) tryImmediateAcquisition() RateLimitInfo {
	rl.mutex.Lock()
	defer rl.mutex.Unlock()

	rl.refillTokens()

	if rl.currentTokens >= 1.0 {
		rl.currentTokens -= 1.0
		return RateLimitInfo{
			Allowed:   true,
			Remaining: int(rl.currentTokens),
			ResetTime: rl.calculateResetTime(),
		}
	}

	retryAfter := rl.refillInterval.Seconds()
	return RateLimitInfo{
		Allowed:    false,
		Remaining:  0,
		ResetTime:  rl.calculateResetTime(),
		RetryAfter: &retryAfter,
	}
}

// refillTokens refills tokens based on elapsed time
func (rl *RateLimiter) refillTokens() {
	now := time.Now()
	elapsed := now.Sub(rl.lastRefill)
	tokensToAdd := float64(elapsed) / float64(rl.refillInterval)

	if tokensToAdd >= 1.0 {
		rl.currentTokens = math.Min(float64(rl.burstSize), rl.currentTokens+tokensToAdd)
		rl.lastRefill = now
	}
}

// calculateResetTime calculates when tokens will be available
func (rl *RateLimiter) calculateResetTime() time.Time {
	if rl.currentTokens >= float64(rl.burstSize) {
		return time.Now()
	}

	tokensNeeded := float64(rl.burstSize) - rl.currentTokens
	return time.Now().Add(time.Duration(tokensNeeded * float64(rl.refillInterval)))
}

// refillLoop runs background token refill
func (rl *RateLimiter) refillLoop() {
	defer rl.wg.Done()
	
	ticker := time.NewTicker(time.Duration(math.Min(float64(rl.refillInterval), float64(time.Second))))
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			rl.mutex.Lock()
			rl.refillTokens()
			rl.mutex.Unlock()
		case <-rl.stopChan:
			return
		}
	}
}

// processQueue processes queued requests by priority
func (rl *RateLimiter) processQueue() {
	defer rl.wg.Done()
	
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			rl.processQueuedRequests()
		case <-rl.stopChan:
			return
		}
	}
}

// processQueuedRequests processes queued requests by priority
func (rl *RateLimiter) processQueuedRequests() {
	rl.mutex.Lock()
	rl.refillTokens()
	tokensAvailable := rl.currentTokens >= 1.0
	rl.mutex.Unlock()

	if !tokensAvailable {
		return
	}

	// Process high priority first, then normal, then low
	priorities := []Priority{PriorityHigh, PriorityNormal, PriorityLow}

	rl.queueMutex.Lock()
	defer rl.queueMutex.Unlock()

	for _, priority := range priorities {
		queue := rl.requestQueues[priority]
		
		for len(queue) > 0 {
			rl.mutex.Lock()
			if rl.currentTokens < 1.0 {
				rl.mutex.Unlock()
				return
			}
			rl.currentTokens -= 1.0
			rl.mutex.Unlock()

			// Get first request from queue
			request := queue[0]
			rl.requestQueues[priority] = queue[1:]

			// Check if context is still valid
			select {
			case <-request.Context.Done():
				// Context cancelled, skip this request
				continue
			default:
			}

			// Record wait time
			waitTime := time.Since(request.Timestamp)
			rl.recordWaitTime(waitTime)
			rl.incrementProcessed()

			// Send success response
			select {
			case request.Done <- RateLimitInfo{
				Allowed:   true,
				Remaining: int(rl.currentTokens),
				ResetTime: rl.calculateResetTime(),
			}:
			default:
			}
		}
	}
}

// enqueueRequest adds a request to the appropriate priority queue
func (rl *RateLimiter) enqueueRequest(request *QueuedRequest) {
	rl.queueMutex.Lock()
	defer rl.queueMutex.Unlock()
	
	rl.requestQueues[request.Priority] = append(rl.requestQueues[request.Priority], request)
}

// removeFromQueue removes a request from its queue
func (rl *RateLimiter) removeFromQueue(request *QueuedRequest) {
	rl.queueMutex.Lock()
	defer rl.queueMutex.Unlock()
	
	queue := rl.requestQueues[request.Priority]
	for i, r := range queue {
		if r == request {
			rl.requestQueues[request.Priority] = append(queue[:i], queue[i+1:]...)
			break
		}
	}
}

// getTotalQueueSize returns total number of queued requests
func (rl *RateLimiter) getTotalQueueSize() int {
	rl.queueMutex.Lock()
	defer rl.queueMutex.Unlock()
	
	total := 0
	for _, queue := range rl.requestQueues {
		total += len(queue)
	}
	return total
}

// recordWaitTime records a wait time for statistics
func (rl *RateLimiter) recordWaitTime(waitTime time.Duration) {
	rl.waitTimesMutex.Lock()
	defer rl.waitTimesMutex.Unlock()
	
	rl.waitTimes = append(rl.waitTimes, waitTime)
	
	// Keep only last 1000 wait times
	if len(rl.waitTimes) > 1000 {
		rl.waitTimes = rl.waitTimes[len(rl.waitTimes)-1000:]
	}
}

// incrementProcessed atomically increments processed counter
func (rl *RateLimiter) incrementProcessed() {
	rl.mutex.Lock()
	rl.totalProcessed++
	rl.mutex.Unlock()
}

// incrementQueued atomically increments queued counter
func (rl *RateLimiter) incrementQueued() {
	rl.mutex.Lock()
	rl.totalQueued++
	rl.mutex.Unlock()
}

// incrementRejected atomically increments rejected counter
func (rl *RateLimiter) incrementRejected() {
	rl.mutex.Lock()
	rl.totalRejected++
	rl.mutex.Unlock()
}

// GetStats returns current rate limiter statistics
func (rl *RateLimiter) GetStats() RateLimiterStats {
	rl.mutex.RLock()
	currentTokens := rl.currentTokens
	totalProcessed := rl.totalProcessed
	totalQueued := rl.totalQueued
	totalRejected := rl.totalRejected
	rl.mutex.RUnlock()

	rl.queueMutex.Lock()
	queuedByPriority := map[string]int{
		"high":   len(rl.requestQueues[PriorityHigh]),
		"normal": len(rl.requestQueues[PriorityNormal]),
		"low":    len(rl.requestQueues[PriorityLow]),
	}
	totalQueueSize := queuedByPriority["high"] + queuedByPriority["normal"] + queuedByPriority["low"]
	rl.queueMutex.Unlock()

	rl.waitTimesMutex.Lock()
	averageWaitTime := 0.0
	if len(rl.waitTimes) > 0 {
		var total time.Duration
		for _, wt := range rl.waitTimes {
			total += wt
		}
		averageWaitTime = float64(total) / float64(len(rl.waitTimes)) / float64(time.Millisecond)
	}
	rl.waitTimesMutex.Unlock()

	return RateLimiterStats{
		RequestsPerSecond: rl.requestsPerSecond,
		BurstSize:         rl.burstSize,
		CurrentTokens:     currentTokens,
		QueueSize:         totalQueueSize,
		QueuedByPriority:  queuedByPriority,
		TotalProcessed:    totalProcessed,
		TotalQueued:       totalQueued,
		TotalRejected:     totalRejected,
		AverageWaitTime:   averageWaitTime,
	}
}

// IsHealthy checks if rate limiter is healthy
func (rl *RateLimiter) IsHealthy() bool {
	stats := rl.GetStats()
	queueUtilization := float64(stats.QueueSize) / float64(rl.queueSize)
	
	return queueUtilization < 0.8 // Healthy if queue is less than 80% full
}

// Reset resets rate limiter state
func (rl *RateLimiter) Reset() {
	rl.mutex.Lock()
	rl.currentTokens = float64(rl.burstSize)
	rl.lastRefill = time.Now()
	rl.totalProcessed = 0
	rl.totalQueued = 0
	rl.totalRejected = 0
	rl.mutex.Unlock()

	// Clear all queues and reject pending requests
	rl.queueMutex.Lock()
	for priority, queue := range rl.requestQueues {
		for _, request := range queue {
			select {
			case request.Done <- RateLimitInfo{
				Allowed: false,
			}:
			default:
			}
		}
		rl.requestQueues[priority] = make([]*QueuedRequest, 0)
	}
	rl.queueMutex.Unlock()

	// Reset wait times
	rl.waitTimesMutex.Lock()
	rl.waitTimes = make([]time.Duration, 0, 1000)
	rl.waitTimesMutex.Unlock()
}

// Close gracefully shuts down the rate limiter
func (rl *RateLimiter) Close() error {
	// Signal background goroutines to stop
	close(rl.stopChan)
	
	// Wait for background goroutines to finish
	rl.wg.Wait()

	// Reject all pending requests
	rl.queueMutex.Lock()
	for priority, queue := range rl.requestQueues {
		for _, request := range queue {
			select {
			case request.Done <- RateLimitInfo{
				Allowed: false,
			}:
			default:
			}
		}
		rl.requestQueues[priority] = make([]*QueuedRequest, 0)
	}
	rl.queueMutex.Unlock()

	return nil
}

// AdaptiveRateLimiter extends RateLimiter with adaptive behavior
type AdaptiveRateLimiter struct {
	*RateLimiter
	baseRequestsPerSecond int
	maxRequestsPerSecond  int
	minRequestsPerSecond  int
	adaptationFactor      float64
	
	successCount    int64
	errorCount      int64
	lastAdaptation  time.Time
	adaptationMutex sync.Mutex
	
	adaptationStopChan chan struct{}
	adaptationWG       sync.WaitGroup
}

// NewAdaptiveRateLimiter creates a new adaptive rate limiter
func NewAdaptiveRateLimiter(config RateLimitConfig, maxRPS, minRPS int, adaptationFactor float64) *AdaptiveRateLimiter {
	if maxRPS == 0 {
		maxRPS = config.RequestsPerSecond * 2
	}
	if minRPS == 0 {
		minRPS = config.RequestsPerSecond / 2
	}
	if adaptationFactor == 0 {
		adaptationFactor = 0.1
	}

	arl := &AdaptiveRateLimiter{
		RateLimiter:           NewRateLimiter(config),
		baseRequestsPerSecond: config.RequestsPerSecond,
		maxRequestsPerSecond:  maxRPS,
		minRequestsPerSecond:  minRPS,
		adaptationFactor:      adaptationFactor,
		lastAdaptation:        time.Now(),
		adaptationStopChan:    make(chan struct{}),
	}

	// Start adaptation loop
	arl.adaptationWG.Add(1)
	go arl.adaptationLoop()

	return arl
}

// RecordSuccess records a successful request
func (arl *AdaptiveRateLimiter) RecordSuccess() {
	arl.adaptationMutex.Lock()
	arl.successCount++
	arl.adaptationMutex.Unlock()
}

// RecordError records a failed request
func (arl *AdaptiveRateLimiter) RecordError() {
	arl.adaptationMutex.Lock()
	arl.errorCount++
	arl.adaptationMutex.Unlock()
}

// adaptationLoop periodically adapts rate limits
func (arl *AdaptiveRateLimiter) adaptationLoop() {
	defer arl.adaptationWG.Done()
	
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			arl.adaptRateLimit()
		case <-arl.adaptationStopChan:
			return
		}
	}
}

// adaptRateLimit adapts rate limit based on success/error ratio
func (arl *AdaptiveRateLimiter) adaptRateLimit() {
	arl.adaptationMutex.Lock()
	defer arl.adaptationMutex.Unlock()

	now := time.Now()
	if now.Sub(arl.lastAdaptation) < 10*time.Second {
		return
	}

	totalRequests := arl.successCount + arl.errorCount
	if totalRequests < 10 {
		return
	}

	successRate := float64(arl.successCount) / float64(totalRequests)
	newRequestsPerSecond := arl.requestsPerSecond

	if successRate > 0.95 {
		// High success rate, increase rate limit
		newRequestsPerSecond = int(math.Min(
			float64(arl.maxRequestsPerSecond),
			float64(arl.requestsPerSecond)*(1+arl.adaptationFactor),
		))
	} else if successRate < 0.8 {
		// Low success rate, decrease rate limit
		newRequestsPerSecond = int(math.Max(
			float64(arl.minRequestsPerSecond),
			float64(arl.requestsPerSecond)*(1-arl.adaptationFactor),
		))
	}

	if newRequestsPerSecond != arl.requestsPerSecond {
		fmt.Printf("Adapting rate limit from %d to %d RPS\n", arl.requestsPerSecond, newRequestsPerSecond)
		arl.requestsPerSecond = newRequestsPerSecond
		arl.refillInterval = time.Second / time.Duration(newRequestsPerSecond)
	}

	// Reset counters
	arl.successCount = 0
	arl.errorCount = 0
	arl.lastAdaptation = now
}

// Close gracefully shuts down the adaptive rate limiter
func (arl *AdaptiveRateLimiter) Close() error {
	close(arl.adaptationStopChan)
	arl.adaptationWG.Wait()
	return arl.RateLimiter.Close()
}