"""
Advanced rate limiter with priority queues and adaptive limits
Author: SwappiQ Protocol
Description: Production-grade rate limiting for API clients with burst handling and fair queuing
"""

import asyncio
import time
from typing import Dict, List, Optional, Literal
from dataclasses import dataclass, field
from collections import defaultdict, deque
import logging

from .types import RateLimitConfig

logger = logging.getLogger(__name__)

@dataclass
class RateLimitInfo:
    allowed: bool
    remaining: int
    reset_time: float
    retry_after: Optional[float] = None
    queue_position: Optional[int] = None

@dataclass
class QueuedRequest:
    priority: Literal['low', 'normal', 'high']
    future: asyncio.Future
    timestamp: float
    timeout_handle: Optional[asyncio.Handle] = None

@dataclass
class RateLimiterStats:
    requests_per_second: int
    burst_size: int
    current_tokens: float
    queue_size: int
    queued_by_priority: Dict[str, int]
    total_processed: int
    total_queued: int
    total_rejected: int
    average_wait_time: float

class RateLimiter:
    """Token bucket rate limiter with priority queues and adaptive behavior"""
    
    def __init__(self, config: RateLimitConfig):
        self.requests_per_second = config.requests_per_second
        self.burst_size = config.burst_size
        self.queue_size = config.queue_size
        self.refill_interval = 1.0 / self.requests_per_second
        
        # Token bucket state
        self.current_tokens = float(self.burst_size)
        self.last_refill = time.time()
        
        # Priority queues
        self.request_queues: Dict[str, deque] = {
            'high': deque(),
            'normal': deque(),
            'low': deque()
        }
        
        # Statistics
        self.stats = {
            'total_processed': 0,
            'total_queued': 0,
            'total_rejected': 0,
            'wait_times': deque(maxlen=1000)  # Keep last 1000 wait times
        }
        
        # Background tasks
        self._refill_task: Optional[asyncio.Task] = None
        self._process_task: Optional[asyncio.Task] = None
        self._running = True
        
        # Start background processing
        self._start_background_tasks()
    
    async def acquire(self, priority: Literal['low', 'normal', 'high'] = 'normal') -> RateLimitInfo:
        """Acquire a token for making a request"""
        # Try immediate acquisition
        immediate = self._try_immediate_acquisition()
        if immediate.allowed:
            self.stats['total_processed'] += 1
            return immediate
        
        # Check queue capacity
        total_queued = sum(len(queue) for queue in self.request_queues.values())
        if total_queued >= self.queue_size:
            self.stats['total_rejected'] += 1
            raise Exception("Rate limit queue is full")
        
        # Queue the request
        future = asyncio.Future()
        request = QueuedRequest(
            priority=priority,
            future=future,
            timestamp=time.time()
        )
        
        # Add timeout for queued request
        request.timeout_handle = asyncio.get_event_loop().call_later(
            30.0,  # 30 second timeout
            self._timeout_request,
            request
        )
        
        self.request_queues[priority].append(request)
        self.stats['total_queued'] += 1
        
        try:
            return await future
        except asyncio.CancelledError:
            # Remove from queue if cancelled
            try:
                self.request_queues[priority].remove(request)
            except ValueError:
                pass  # Already removed
            raise
    
    def _try_immediate_acquisition(self) -> RateLimitInfo:
        """Try to acquire token immediately without queuing"""
        self._refill_tokens()
        
        if self.current_tokens >= 1.0:
            self.current_tokens -= 1.0
            return RateLimitInfo(
                allowed=True,
                remaining=int(self.current_tokens),
                reset_time=self._calculate_reset_time()
            )
        
        return RateLimitInfo(
            allowed=False,
            remaining=0,
            reset_time=self._calculate_reset_time(),
            retry_after=self.refill_interval
        )
    
    def _refill_tokens(self) -> None:
        """Refill tokens based on elapsed time"""
        now = time.time()
        elapsed = now - self.last_refill
        tokens_to_add = elapsed / self.refill_interval
        
        if tokens_to_add >= 1.0:
            self.current_tokens = min(self.burst_size, self.current_tokens + tokens_to_add)
            self.last_refill = now
    
    def _calculate_reset_time(self) -> float:
        """Calculate when tokens will be available"""
        if self.current_tokens >= self.burst_size:
            return time.time()  # Already at max capacity
        
        tokens_needed = self.burst_size - self.current_tokens
        return time.time() + (tokens_needed * self.refill_interval)
    
    async def _refill_loop(self) -> None:
        """Background task to refill tokens"""
        while self._running:
            self._refill_tokens()
            await asyncio.sleep(min(self.refill_interval, 1.0))
    
    async def _process_queue(self) -> None:
        """Background task to process queued requests"""
        while self._running:
            await self._process_queued_requests()
            await asyncio.sleep(0.01)  # 10ms processing interval
    
    async def _process_queued_requests(self) -> None:
        """Process queued requests by priority"""
        self._refill_tokens()
        
        # Process high priority first, then normal, then low
        priorities = ['high', 'normal', 'low']
        
        for priority in priorities:
            queue = self.request_queues[priority]
            
            while queue and self.current_tokens >= 1.0:
                request = queue.popleft()
                
                # Cancel timeout
                if request.timeout_handle:
                    request.timeout_handle.cancel()
                
                self.current_tokens -= 1.0
                self.stats['total_processed'] += 1
                
                # Calculate wait time
                wait_time = time.time() - request.timestamp
                self.stats['wait_times'].append(wait_time)
                
                # Resolve the future
                if not request.future.done():
                    request.future.set_result(RateLimitInfo(
                        allowed=True,
                        remaining=int(self.current_tokens),
                        reset_time=self._calculate_reset_time()
                    ))
    
    def _timeout_request(self, request: QueuedRequest) -> None:
        """Handle request timeout"""
        if not request.future.done():
            request.future.set_exception(Exception("Rate limit queue timeout"))
    
    def _start_background_tasks(self) -> None:
        """Start background processing tasks"""
        loop = asyncio.get_event_loop()
        self._refill_task = loop.create_task(self._refill_loop())
        self._process_task = loop.create_task(self._process_queue())
    
    def get_stats(self) -> RateLimiterStats:
        """Get current rate limiter statistics"""
        total_queued = sum(len(queue) for queue in self.request_queues.values())
        
        average_wait_time = 0.0
        if self.stats['wait_times']:
            average_wait_time = sum(self.stats['wait_times']) / len(self.stats['wait_times'])
        
        return RateLimiterStats(
            requests_per_second=self.requests_per_second,
            burst_size=self.burst_size,
            current_tokens=self.current_tokens,
            queue_size=total_queued,
            queued_by_priority={
                'high': len(self.request_queues['high']),
                'normal': len(self.request_queues['normal']),
                'low': len(self.request_queues['low'])
            },
            total_processed=self.stats['total_processed'],
            total_queued=self.stats['total_queued'],
            total_rejected=self.stats['total_rejected'],
            average_wait_time=average_wait_time
        )
    
    def is_healthy(self) -> bool:
        """Check if rate limiter is healthy"""
        total_queued = sum(len(queue) for queue in self.request_queues.values())
        queue_utilization = total_queued / self.queue_size
        
        return queue_utilization < 0.8  # Healthy if queue is less than 80% full
    
    def reset(self) -> None:
        """Reset rate limiter state"""
        self.current_tokens = float(self.burst_size)
        self.last_refill = time.time()
        
        # Clear all queues and reject pending requests
        for priority, queue in self.request_queues.items():
            while queue:
                request = queue.popleft()
                if request.timeout_handle:
                    request.timeout_handle.cancel()
                if not request.future.done():
                    request.future.set_exception(Exception("Rate limiter reset"))
        
        # Reset stats
        self.stats = {
            'total_processed': 0,
            'total_queued': 0,
            'total_rejected': 0,
            'wait_times': deque(maxlen=1000)
        }
    
    async def shutdown(self) -> None:
        """Gracefully shutdown the rate limiter"""
        self._running = False
        
        # Cancel background tasks
        if self._refill_task:
            self._refill_task.cancel()
            try:
                await self._refill_task
            except asyncio.CancelledError:
                pass
        
        if self._process_task:
            self._process_task.cancel()
            try:
                await self._process_task
            except asyncio.CancelledError:
                pass
        
        # Reject all pending requests
        for priority, queue in self.request_queues.items():
            while queue:
                request = queue.popleft()
                if request.timeout_handle:
                    request.timeout_handle.cancel()
                if not request.future.done():
                    request.future.set_exception(Exception("Rate limiter shutting down"))

class AdaptiveRateLimiter(RateLimiter):
    """Adaptive rate limiter that adjusts limits based on response patterns"""
    
    def __init__(self, config: RateLimitConfig, **kwargs):
        self.base_requests_per_second = config.requests_per_second
        self.max_requests_per_second = kwargs.get('max_requests_per_second', config.requests_per_second * 2)
        self.min_requests_per_second = kwargs.get('min_requests_per_second', config.requests_per_second * 0.5)
        self.adaptation_factor = kwargs.get('adaptation_factor', 0.1)
        
        super().__init__(config)
        
        self.success_count = 0
        self.error_count = 0
        self.last_adaptation = time.time()
        
        # Start adaptation task
        self._adaptation_task = asyncio.create_task(self._adaptation_loop())
    
    def record_success(self) -> None:
        """Record a successful request"""
        self.success_count += 1
    
    def record_error(self) -> None:
        """Record a failed request (rate limited or error)"""
        self.error_count += 1
    
    async def _adaptation_loop(self) -> None:
        """Periodically adapt rate limits"""
        while self._running:
            await asyncio.sleep(10.0)  # Adapt every 10 seconds
            self._adapt_rate_limit()
    
    def _adapt_rate_limit(self) -> None:
        """Adapt rate limit based on success/error ratio"""
        now = time.time()
        time_since_adaptation = now - self.last_adaptation
        
        if time_since_adaptation < 10.0:  # Minimum 10 seconds between adaptations
            return
        
        total_requests = self.success_count + self.error_count
        if total_requests < 10:  # Need minimum sample size
            return
        
        success_rate = self.success_count / total_requests
        new_requests_per_second = self.requests_per_second
        
        if success_rate > 0.95:
            # High success rate, increase rate limit
            new_requests_per_second = min(
                self.max_requests_per_second,
                self.requests_per_second * (1 + self.adaptation_factor)
            )
        elif success_rate < 0.8:
            # Low success rate, decrease rate limit
            new_requests_per_second = max(
                self.min_requests_per_second,
                self.requests_per_second * (1 - self.adaptation_factor)
            )
        
        if new_requests_per_second != self.requests_per_second:
            logger.info(f"Adapting rate limit from {self.requests_per_second} to {new_requests_per_second} RPS")
            self.requests_per_second = new_requests_per_second
            self.refill_interval = 1.0 / self.requests_per_second
        
        # Reset counters
        self.success_count = 0
        self.error_count = 0
        self.last_adaptation = now
    
    async def shutdown(self) -> None:
        """Gracefully shutdown the adaptive rate limiter"""
        if hasattr(self, '_adaptation_task'):
            self._adaptation_task.cancel()
            try:
                await self._adaptation_task
            except asyncio.CancelledError:
                pass
        
        await super().shutdown()