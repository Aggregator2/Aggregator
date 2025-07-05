"""
Exception classes for the Offchain Protocol SDK
"""
from typing import Optional, Any, Dict


class OffchainError(Exception):
    """Base exception class for SDK errors"""
    
    def __init__(
        self,
        message: str,
        code: str,
        status_code: Optional[int] = None,
        details: Optional[Any] = None
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details


class AuthenticationError(OffchainError):
    """Authentication failed"""
    
    def __init__(self, message: str = "Authentication failed", details: Optional[Any] = None):
        super().__init__(message, "AUTHENTICATION_ERROR", 401, details)


class ApiError(OffchainError):
    """API request error"""
    
    def __init__(
        self,
        message: str,
        code: str,
        status_code: int,
        details: Optional[Any] = None
    ):
        super().__init__(message, code, status_code, details)


class RateLimitError(OffchainError):
    """Rate limit exceeded"""
    
    def __init__(
        self,
        message: str = "Rate limit exceeded",
        retry_after: int = 60,
        details: Optional[Any] = None
    ):
        super().__init__(message, "RATE_LIMIT_ERROR", 429, details)
        self.retry_after = retry_after


class ValidationError(OffchainError):
    """Request validation error"""
    
    def __init__(self, message: str, details: Optional[Any] = None):
        super().__init__(message, "VALIDATION_ERROR", 400, details)


class NetworkError(OffchainError):
    """Network connection error"""
    
    def __init__(self, message: str = "Network error", details: Optional[Any] = None):
        super().__init__(message, "NETWORK_ERROR", None, details)


class WebSocketError(OffchainError):
    """WebSocket connection error"""
    
    def __init__(self, message: str, details: Optional[Any] = None):
        super().__init__(message, "WEBSOCKET_ERROR", None, details)


class TimeoutError(OffchainError):
    """Request timeout"""
    
    def __init__(self, message: str = "Request timeout", details: Optional[Any] = None):
        super().__init__(message, "TIMEOUT_ERROR", 408, details)


class InsufficientBalanceError(OffchainError):
    """Insufficient balance for order"""
    
    def __init__(self, message: str = "Insufficient balance", details: Optional[Any] = None):
        super().__init__(message, "INSUFFICIENT_BALANCE", 400, details)


class OrderNotFoundError(OffchainError):
    """Order not found"""
    
    def __init__(self, order_id: str, details: Optional[Any] = None):
        super().__init__(f"Order {order_id} not found", "ORDER_NOT_FOUND", 404, details)


class InvalidOrderError(OffchainError):
    """Invalid order parameters"""
    
    def __init__(self, message: str, details: Optional[Any] = None):
        super().__init__(message, "INVALID_ORDER", 400, details)