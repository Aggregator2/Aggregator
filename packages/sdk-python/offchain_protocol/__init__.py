"""
Offchain Protocol Python SDK

A Python SDK for interacting with the Offchain Protocol API.

Example:
    >>> from offchain_protocol import OffchainClient
    >>> 
    >>> client = OffchainClient('your-api-key', testnet=True)
    >>> 
    >>> # Create an order
    >>> order = await client.create_order({
    ...     'pair': 'BTC/USDT',
    ...     'side': 'buy',
    ...     'type': 'limit',
    ...     'quantity': '0.1',
    ...     'price': '45000'
    ... })
    >>> 
    >>> # Get order book
    >>> orderbook = await client.get_orderbook('BTC/USDT')
    >>> 
    >>> # Stream trades
    >>> async for trade in client.stream_trades('BTC/USDT'):
    ...     print(f"Trade: {trade.price} @ {trade.quantity}")
"""

from .client import OffchainClient
from .types import (
    Order,
    OrderSide,
    OrderType,
    OrderStatus,
    TimeInForce,
    Trade,
    OrderBook,
    Settlement,
    SettlementStatus,
    Ticker,
    Candle,
    CandleInterval,
    Notification,
    NotificationType,
)
from .exceptions import (
    OffchainError,
    AuthenticationError,
    ApiError,
    RateLimitError,
    ValidationError,
    NetworkError,
    WebSocketError,
    TimeoutError,
    InsufficientBalanceError,
    OrderNotFoundError,
    InvalidOrderError,
)

__version__ = "1.0.0"

__all__ = [
    # Client
    "OffchainClient",
    
    # Types
    "Order",
    "OrderSide",
    "OrderType",
    "OrderStatus",
    "TimeInForce",
    "Trade",
    "OrderBook",
    "Settlement",
    "SettlementStatus",
    "Ticker",
    "Candle",
    "CandleInterval",
    "Notification",
    "NotificationType",
    
    # Exceptions
    "OffchainError",
    "AuthenticationError",
    "ApiError",
    "RateLimitError",
    "ValidationError",
    "NetworkError",
    "WebSocketError",
    "TimeoutError",
    "InsufficientBalanceError",
    "OrderNotFoundError",
    "InvalidOrderError",
]