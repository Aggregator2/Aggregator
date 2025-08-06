"""
HTTP client with automatic retry and exponential backoff for SwappiQ Protocol
Author: SwappiQ Protocol
Description: Production-ready HTTP client with comprehensive error handling and retry logic
"""

import asyncio
import aiohttp
import json
import time
import logging
from typing import Any, Dict, List, Optional, Union
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlencode
import random
import hashlib

from .types import (
    SDKConfig, ApiResponse, ApiError, AuthCredentials, 
    RetryConfig, RateLimitConfig
)
from .request_signer import RequestSigner
from .rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

@dataclass
class RequestOptions:
    method: str
    path: str
    body: Optional[Dict[str, Any]] = None
    headers: Optional[Dict[str, str]] = None
    auth: bool = False
    timeout: Optional[float] = None
    retries: Optional[int] = None
    priority: str = "normal"  # low, normal, high

@dataclass
class RequestMetrics:
    request_id: str
    method: str
    path: str
    start_time: float
    end_time: float
    duration: float
    status: int
    success: bool
    retry_count: int
    from_cache: bool

class HttpError(Exception):
    """HTTP-specific error with status code"""
    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status

class TimeoutError(Exception):
    """Request timeout error"""
    pass

class HttpClient:
    """Production-grade HTTP client with enterprise features"""
    
    def __init__(self, config: SDKConfig):
        self.base_url = config.api_url.rstrip('/')
        self.auth = config.auth
        self.retry_config = config.retry_config
        self.rate_limit_config = config.rate_limit_config
        self.timeout = config.timeout
        self.debug = config.debug
        
        # Initialize components
        self.request_signer = RequestSigner(config.auth) if config.auth else None
        self.rate_limiter = RateLimiter(config.rate_limit_config) if config.rate_limit_config else None
        
        # State management
        self.response_cache: Dict[str, Any] = {}
        self.active_requests: Dict[str, asyncio.Task] = {}
        self.request_counter = 0
        self.metrics: List[RequestMetrics] = []
        
        # Session for connection pooling
        self.session: Optional[aiohttp.ClientSession] = None
        
    async def __aenter__(self):
        await self._create_session()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
        
    async def _create_session(self):
        """Create aiohttp session with optimal settings"""
        timeout = aiohttp.ClientTimeout(total=self.timeout)
        connector = aiohttp.TCPConnector(
            limit=100,  # Total connection pool size
            limit_per_host=30,  # Per-host connection limit
            keepalive_timeout=30,
            enable_cleanup_closed=True
        )
        
        self.session = aiohttp.ClientSession(
            timeout=timeout,
            connector=connector,
            headers={
                'User-Agent': 'SwappiQ-SDK-Python/1.0.0',
                'Content-Type': 'application/json'
            }
        )
        
    async def request(self, options: RequestOptions) -> ApiResponse:
        """Make a type-safe API request with automatic retry and rate limiting"""
        request_id = self._generate_request_id()
        start_time = time.time()
        
        try:
            # Rate limiting check
            if self.rate_limiter:
                await self.rate_limiter.acquire(options.priority)
                
            # Check for duplicate requests
            duplicate_key = self._get_duplicate_key(options)
            if duplicate_key in self.active_requests:
                if self.debug:
                    logger.debug(f"[{request_id}] Waiting for duplicate request: {duplicate_key}")
                return await self.active_requests[duplicate_key]
                
            # Check cache for GET requests
            if options.method == 'GET':
                cached = self._get_from_cache(options.path)
                if cached:
                    self._record_metrics(RequestMetrics(
                        request_id=request_id,
                        method=options.method,
                        path=options.path,
                        start_time=start_time,
                        end_time=time.time(),
                        duration=0,
                        status=200,
                        success=True,
                        retry_count=0,
                        from_cache=True
                    ))
                    return cached
                    
            # Create the request task
            request_task = asyncio.create_task(
                self._execute_request(options, request_id, start_time)
            )
            self.active_requests[duplicate_key] = request_task
            
            try:
                response = await request_task
                
                # Cache successful GET responses
                if options.method == 'GET' and response.success:
                    self._cache_response(options.path, response)
                    
                return response
            finally:
                self.active_requests.pop(duplicate_key, None)
                
        except Exception as error:
            self._record_metrics(RequestMetrics(
                request_id=request_id,
                method=options.method,
                path=options.path,
                start_time=start_time,
                end_time=time.time(),
                duration=time.time() - start_time,
                status=0,
                success=False,
                retry_count=0,
                from_cache=False
            ))
            raise self._create_api_error(error, request_id)
            
    async def _execute_request(self, options: RequestOptions, request_id: str, start_time: float) -> ApiResponse:
        """Execute request with retry logic"""
        last_error: Optional[Exception] = None
        retry_count = 0
        max_retries = options.retries if options.retries is not None else self.retry_config.max_attempts
        
        while retry_count <= max_retries:
            try:
                response = await self._make_http_request(options, request_id)
                
                self._record_metrics(RequestMetrics(
                    request_id=request_id,
                    method=options.method,
                    path=options.path,
                    start_time=start_time,
                    end_time=time.time(),
                    duration=time.time() - start_time,
                    status=200,
                    success=response.success,
                    retry_count=retry_count,
                    from_cache=False
                ))
                
                return response
                
            except Exception as error:
                last_error = error
                
                if retry_count == max_retries or not self._is_retryable_error(error):
                    break
                    
                retry_count += 1
                delay = self._calculate_retry_delay(retry_count)
                
                if self.debug:
                    logger.warning(f"[{request_id}] Retry {retry_count}/{max_retries} after {delay}s: {str(error)}")
                    
                await asyncio.sleep(delay)
                
        self._record_metrics(RequestMetrics(
            request_id=request_id,
            method=options.method,
            path=options.path,
            start_time=start_time,
            end_time=time.time(),
            duration=time.time() - start_time,
            status=0,
            success=False,
            retry_count=retry_count,
            from_cache=False
        ))
        
        raise last_error
        
    async def _make_http_request(self, options: RequestOptions, request_id: str) -> ApiResponse:
        """Make the actual HTTP request"""
        if not self.session:
            await self._create_session()
            
        url = urljoin(self.base_url, options.path)
        method = options.method.upper()
        
        # Prepare headers
        headers = {
            'X-Request-ID': request_id,
            **(options.headers or {})
        }
        
        # Prepare body
        data = None
        if options.body:
            data = json.dumps(options.body, separators=(',', ':'))
            
        # Sign request if authentication is required
        if options.auth and self.request_signer:
            signed_request = await self.request_signer.sign_request(
                method=method,
                path=options.path,
                body=data or '',
                timestamp=str(int(time.time() * 1000))
            )
            headers.update(signed_request.headers)
            
        if self.debug:
            logger.debug(f"[{request_id}] {method} {url}")
            
        timeout = aiohttp.ClientTimeout(total=options.timeout or self.timeout)
        
        try:
            async with self.session.request(
                method=method,
                url=url,
                data=data,
                headers=headers,
                timeout=timeout
            ) as response:
                
                if not response.ok:
                    raise HttpError(f"HTTP {response.status}: {response.reason}", response.status)
                    
                response_data = await response.json()
                
                # Validate response structure
                if not self._is_valid_api_response(response_data):
                    raise ValueError("Invalid API response structure")
                    
                if self.debug:
                    logger.debug(f"[{request_id}] Response: {self._sanitize_response(response_data)}")
                    
                return ApiResponse(**response_data)
                
        except asyncio.TimeoutError:
            raise TimeoutError(f"Request timeout after {options.timeout or self.timeout}s")
            
    def _calculate_retry_delay(self, attempt: int) -> float:
        """Calculate exponential backoff delay with jitter"""
        base_delay = self.retry_config.base_delay
        backoff_factor = self.retry_config.backoff_factor
        max_delay = self.retry_config.max_delay
        jitter = self.retry_config.jitter
        
        delay = min(base_delay * (backoff_factor ** (attempt - 1)), max_delay)
        
        if jitter:
            # Add random jitter ±25%
            jitter_amount = delay * 0.25
            delay += (random.random() - 0.5) * 2 * jitter_amount
            
        return max(0.1, delay)  # Minimum 100ms delay
        
    def _is_retryable_error(self, error: Exception) -> bool:
        """Check if error is retryable"""
        if isinstance(error, TimeoutError):
            return True
        if isinstance(error, HttpError):
            return error.status >= 500 or error.status == 429  # Server errors and rate limiting
            
        error_message = str(error).lower()
        return any(retryable_error.lower() in error_message 
                  for retryable_error in self.retry_config.retryable_errors)
                  
    def _is_valid_api_response(self, data: Any) -> bool:
        """Validate API response structure"""
        return (
            isinstance(data, dict) and
            'success' in data and
            isinstance(data['success'], bool) and
            'timestamp' in data and
            'request_id' in data
        )
        
    def _create_api_error(self, error: Exception, request_id: str) -> ApiError:
        """Create standardized API error"""
        if isinstance(error, HttpError):
            return ApiError(
                code=f"HTTP_{error.status}",
                message=str(error),
                details={'status': error.status, 'request_id': request_id},
                retryable=self._is_retryable_error(error)
            )
            
        if isinstance(error, TimeoutError):
            return ApiError(
                code='TIMEOUT',
                message=str(error),
                details={'request_id': request_id},
                retryable=True
            )
            
        return ApiError(
            code='UNKNOWN_ERROR',
            message=str(error),
            details={'request_id': request_id},
            retryable=False
        )
        
    def _get_from_cache(self, path: str) -> Optional[ApiResponse]:
        """Get response from cache"""
        cached = self.response_cache.get(path)
        if not cached:
            return None
            
        if time.time() - cached['timestamp'] > 30:  # 30 second TTL
            del self.response_cache[path]
            return None
            
        return cached['response']
        
    def _cache_response(self, path: str, response: ApiResponse) -> None:
        """Cache response"""
        self.response_cache[path] = {
            'response': response,
            'timestamp': time.time()
        }
        
    def _generate_request_id(self) -> str:
        """Generate unique request ID"""
        self.request_counter += 1
        return f"req_{int(time.time() * 1000)}_{self.request_counter}_{random.randint(1000, 9999)}"
        
    def _get_duplicate_key(self, options: RequestOptions) -> str:
        """Get key for duplicate request detection"""
        body_hash = ""
        if options.body:
            body_str = json.dumps(options.body, sort_keys=True, separators=(',', ':'))
            body_hash = hashlib.md5(body_str.encode()).hexdigest()
        return f"{options.method}:{options.path}:{body_hash}"
        
    def _record_metrics(self, metrics: RequestMetrics) -> None:
        """Record request metrics"""
        self.metrics.append(metrics)
        
        # Keep only last 1000 metrics
        if len(self.metrics) > 1000:
            self.metrics = self.metrics[-1000:]
            
    def _sanitize_response(self, response: Dict[str, Any]) -> Dict[str, Any]:
        """Sanitize response for logging"""
        sanitized = response.copy()
        if 'data' in sanitized and isinstance(sanitized['data'], dict):
            data = sanitized['data'].copy()
            sensitive_fields = ['api_secret', 'private_key', 'password', 'signature']
            for field in sensitive_fields:
                if field in data:
                    data[field] = '[REDACTED]'
            sanitized['data'] = data
        return sanitized
        
    def get_stats(self) -> Dict[str, Any]:
        """Get client statistics"""
        recent_metrics = [m for m in self.metrics if time.time() - m.end_time < 3600]  # Last hour
        successful_requests = [m for m in recent_metrics if m.success]
        failed_requests = [m for m in recent_metrics if not m.success]
        
        return {
            'total_requests': len(recent_metrics),
            'successful_requests': len(successful_requests),
            'failed_requests': len(failed_requests),
            'success_rate': len(successful_requests) / max(len(recent_metrics), 1),
            'average_response_time': sum(m.duration for m in recent_metrics) / max(len(recent_metrics), 1),
            'cache_hit_rate': len([m for m in recent_metrics if m.from_cache]) / max(len(recent_metrics), 1),
            'active_cache_entries': len(self.response_cache),
            'active_requests': len(self.active_requests),
            'rate_limiter_stats': self.rate_limiter.get_stats() if self.rate_limiter else None
        }
        
    def is_healthy(self) -> bool:
        """Check if client is healthy"""
        stats = self.get_stats()
        return (
            stats['success_rate'] > 0.95 and
            stats['average_response_time'] < 5.0 and  # Less than 5 seconds
            len(self.active_requests) < 50  # Not too many concurrent requests
        )
        
    async def close(self) -> None:
        """Clean up resources"""
        if self.session:
            await self.session.close()
            
        # Cancel active requests
        for task in self.active_requests.values():
            if not task.done():
                task.cancel()
                
        self.active_requests.clear()
        self.response_cache.clear()
        self.metrics.clear()