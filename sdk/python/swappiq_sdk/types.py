"""
Type definitions for SwappiQ Protocol Python SDK
Author: SwappiQ Protocol
Description: Comprehensive type definitions with dataclasses for type safety
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Union, Literal, Any
from enum import Enum
from decimal import Decimal
import datetime

# ========== ENUMS ==========

class Network(Enum):
    ETHEREUM = "ethereum"
    POLYGON = "polygon"
    BSC = "bsc"
    ARBITRUM = "arbitrum"
    OPTIMISM = "optimism"

class OrderSide(Enum):
    BUY = "buy"
    SELL = "sell"

class OrderType(Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_LIMIT = "stop_limit"

class OrderStatus(Enum):
    PENDING = "pending"
    OPEN = "open"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    REJECTED = "rejected"

class TimeInForce(Enum):
    GTC = "GTC"  # Good Till Cancelled
    IOC = "IOC"  # Immediate Or Cancel
    FOK = "FOK"  # Fill Or Kill
    GTD = "GTD"  # Good Till Date

# ========== BASE TYPES ==========

@dataclass(frozen=True)
class Address:
    value: str
    network: Network

@dataclass(frozen=True)
class DecimalAmount:
    value: str  # Use string to preserve precision
    decimals: int

    @property
    def decimal_value(self) -> Decimal:
        """Get as Python Decimal for calculations"""
        return Decimal(self.value) / (10 ** self.decimals)

@dataclass(frozen=True)
class TokenAmount:
    token: Address
    amount: DecimalAmount
    usd_value: Optional[DecimalAmount] = None

# ========== API RESPONSE TYPES ==========

@dataclass
class ApiError:
    code: str
    message: str
    details: Optional[Dict[str, Any]] = None
    retryable: bool = False

@dataclass
class ApiResponse:
    success: bool
    timestamp: str
    request_id: str
    data: Optional[Any] = None
    error: Optional[ApiError] = None

@dataclass
class PaginatedResponse:
    items: List[Any]
    total: int
    page: int
    limit: int
    has_next: bool
    has_previous: bool

# ========== TOKEN AND TRADING PAIR TYPES ==========

@dataclass(frozen=True)
class TokenInfo:
    address: Address
    symbol: str
    name: str
    decimals: int
    logo_url: Optional[str] = None
    verified: bool = True
    metadata: Optional[Dict[str, Any]] = None

@dataclass(frozen=True)
class TradingPair:
    symbol: str
    base_token: TokenInfo
    quote_token: TokenInfo
    min_order_size: DecimalAmount
    max_order_size: DecimalAmount
    price_increment: DecimalAmount
    quantity_increment: DecimalAmount
    maker_fee: DecimalAmount
    taker_fee: DecimalAmount
    status: Literal["active", "inactive", "delisted"]
    metadata: Optional[Dict[str, Any]] = None

# ========== ORDER TYPES ==========

@dataclass
class BaseOrder:
    id: str
    user_id: str
    trading_pair: str
    side: OrderSide
    type: OrderType
    quantity: DecimalAmount
    status: OrderStatus
    time_in_force: TimeInForce
    created_at: datetime.datetime
    updated_at: datetime.datetime
    expires_at: Optional[datetime.datetime] = None
    client_order_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

@dataclass
class LimitOrder(BaseOrder):
    price: DecimalAmount
    type: OrderType = field(default=OrderType.LIMIT, init=False)

@dataclass
class MarketOrder(BaseOrder):
    type: OrderType = field(default=OrderType.MARKET, init=False)

@dataclass
class StopOrder(BaseOrder):
    stop_price: DecimalAmount
    type: OrderType = field(default=OrderType.STOP, init=False)

@dataclass
class StopLimitOrder(BaseOrder):
    price: DecimalAmount
    stop_price: DecimalAmount
    type: OrderType = field(default=OrderType.STOP_LIMIT, init=False)

Order = Union[LimitOrder, MarketOrder, StopOrder, StopLimitOrder]

# ========== ORDER CREATION TYPES ==========

@dataclass
class CreateOrderRequest:
    trading_pair: str
    side: OrderSide
    type: OrderType
    quantity: str
    price: Optional[str] = None
    stop_price: Optional[str] = None
    time_in_force: TimeInForce = TimeInForce.GTC
    client_order_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    signature: Optional[str] = None

@dataclass
class TradeFee:
    token: Address
    amount: DecimalAmount
    type: Literal["maker", "taker", "gas"]

@dataclass
class ExecutionReport:
    order_id: str
    execution_id: str
    trading_pair: str
    side: OrderSide
    executed_quantity: DecimalAmount
    executed_price: DecimalAmount
    remaining_quantity: DecimalAmount
    status: OrderStatus
    fees: List[TradeFee]
    timestamp: datetime.datetime
    counterparty_order_id: Optional[str] = None

@dataclass
class CreateOrderResponse:
    success: bool
    order: Optional[Order] = None
    error: Optional[ApiError] = None
    estimated_gas: Optional[str] = None
    execution_report: Optional[ExecutionReport] = None

# ========== ORDER BOOK TYPES ==========

@dataclass(frozen=True)
class OrderBookLevel:
    price: DecimalAmount
    quantity: DecimalAmount
    order_count: int

@dataclass
class OrderBook:
    trading_pair: str
    bids: List[OrderBookLevel]
    asks: List[OrderBookLevel]
    sequence: int
    timestamp: datetime.datetime
    spread: Optional[DecimalAmount] = None
    mid_price: Optional[DecimalAmount] = None

@dataclass
class OrderBookUpdate:
    trading_pair: str
    side: OrderSide
    price: DecimalAmount
    quantity: DecimalAmount
    sequence: int
    timestamp: datetime.datetime
    type: Literal["add", "update", "remove"]

# ========== TRADE TYPES ==========

@dataclass
class Trade:
    id: str
    trading_pair: str
    price: DecimalAmount
    quantity: DecimalAmount
    side: OrderSide
    timestamp: datetime.datetime
    buy_order_id: str
    sell_order_id: str
    fees: List[TradeFee]
    block_number: Optional[int] = None
    transaction_hash: Optional[str] = None

@dataclass
class UserTrade(Trade):
    user_side: OrderSide
    order_id: str
    fees_paid: List[TradeFee]
    realized_pnl: Optional[DecimalAmount] = None

# ========== BALANCE TYPES ==========

@dataclass
class Balance:
    token: Address
    available: DecimalAmount
    locked: DecimalAmount
    total: DecimalAmount
    usd_value: Optional[DecimalAmount] = None
    last_updated: datetime.datetime

@dataclass
class Portfolio:
    user_id: str
    balances: List[Balance]
    total_usd_value: DecimalAmount
    network: Network
    last_updated: datetime.datetime

# ========== MARKET DATA TYPES ==========

@dataclass
class MarketStats:
    trading_pair: str
    last_price: DecimalAmount
    price_change_24h: DecimalAmount
    price_change_percent_24h: DecimalAmount
    high_24h: DecimalAmount
    low_24h: DecimalAmount
    volume_24h: DecimalAmount
    quote_volume_24h: DecimalAmount
    timestamp: datetime.datetime

@dataclass
class Ticker:
    trading_pair: str
    price: DecimalAmount
    timestamp: datetime.datetime
    source: str

@dataclass
class Candle:
    trading_pair: str
    interval: str
    open_time: datetime.datetime
    close_time: datetime.datetime
    open: DecimalAmount
    high: DecimalAmount
    low: DecimalAmount
    close: DecimalAmount
    volume: DecimalAmount
    quote_volume: DecimalAmount
    trades: int

# ========== AUTHENTICATION TYPES ==========

@dataclass
class AuthCredentials:
    api_key: str
    api_secret: str
    passphrase: Optional[str] = None
    environment: Literal["sandbox", "production"] = "production"

@dataclass
class SignedRequest:
    method: str
    path: str
    body: str
    timestamp: str
    signature: str
    headers: Dict[str, str]

# ========== WEBSOCKET TYPES ==========

@dataclass
class WebSocketMessage:
    type: str
    channel: str
    data: Any
    timestamp: datetime.datetime
    sequence: Optional[int] = None

@dataclass
class SubscriptionRequest:
    type: Literal["subscribe", "unsubscribe"]
    channels: List[str]
    trading_pairs: Optional[List[str]] = None
    auth: bool = False

@dataclass
class WebSocketConfig:
    url: str
    reconnect_interval: int = 5000
    max_reconnect_attempts: int = 10
    ping_interval: int = 30000
    auth: Optional[AuthCredentials] = None

# ========== VALIDATION TYPES ==========

@dataclass
class ValidationError:
    field: str
    code: str
    message: str
    value: Optional[Any] = None

@dataclass
class ValidationResult:
    valid: bool
    errors: List[ValidationError]

@dataclass
class OrderValidation:
    balance_sufficient: bool
    price_valid: bool
    quantity_valid: bool
    trading_pair_active: bool
    within_limits: bool
    estimated_fees: List[TradeFee]
    estimated_gas: Optional[str] = None
    errors: List[ValidationError] = field(default_factory=list)
    warnings: List[ValidationError] = field(default_factory=list)

# ========== EVENT TYPES ==========

@dataclass
class OrderEvent:
    type: Literal["order_created", "order_updated", "order_filled", "order_cancelled"]
    order: Order
    timestamp: datetime.datetime

@dataclass
class TradeEvent:
    type: Literal["trade_executed"]
    trade: UserTrade
    timestamp: datetime.datetime

@dataclass
class BalanceEvent:
    type: Literal["balance_updated"]
    balance: Balance
    timestamp: datetime.datetime

UserEvent = Union[OrderEvent, TradeEvent, BalanceEvent]

# ========== CONFIGURATION TYPES ==========

@dataclass
class RetryConfig:
    max_attempts: int = 3
    base_delay: float = 1.0
    max_delay: float = 10.0
    backoff_factor: float = 2.0
    jitter: bool = True
    retryable_errors: List[str] = field(default_factory=lambda: ["ECONNRESET", "TIMEOUT", "RATE_LIMITED"])

@dataclass
class RateLimitConfig:
    requests_per_second: int = 10
    burst_size: int = 20
    queue_size: int = 100

@dataclass
class SDKConfig:
    api_url: str
    ws_url: Optional[str] = None
    auth: Optional[AuthCredentials] = None
    network: Network = Network.ETHEREUM
    timeout: float = 30.0
    retry_config: RetryConfig = field(default_factory=RetryConfig)
    rate_limit_config: Optional[RateLimitConfig] = None
    debug: bool = False

# ========== REQUEST PARAMETER TYPES ==========

@dataclass
class PaginationParams:
    page: Optional[int] = None
    limit: Optional[int] = None
    sort_by: Optional[str] = None
    sort_order: Literal["asc", "desc"] = "desc"

@dataclass
class OrderHistoryParams(PaginationParams):
    trading_pair: Optional[str] = None
    status: Optional[List[OrderStatus]] = None
    side: Optional[OrderSide] = None
    start_time: Optional[datetime.datetime] = None
    end_time: Optional[datetime.datetime] = None

@dataclass
class TradeHistoryParams(PaginationParams):
    trading_pair: Optional[str] = None
    start_time: Optional[datetime.datetime] = None
    end_time: Optional[datetime.datetime] = None

@dataclass
class CandleParams:
    trading_pair: str
    interval: Literal["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]
    start_time: Optional[datetime.datetime] = None
    end_time: Optional[datetime.datetime] = None
    limit: Optional[int] = None

# ========== TYPE GUARDS / UTILITY FUNCTIONS ==========

def is_limit_order(order: Order) -> bool:
    return isinstance(order, LimitOrder)

def is_market_order(order: Order) -> bool:
    return isinstance(order, MarketOrder)

def is_stop_order(order: Order) -> bool:
    return isinstance(order, StopOrder)

def is_stop_limit_order(order: Order) -> bool:
    return isinstance(order, StopLimitOrder)

def is_order_event(event: UserEvent) -> bool:
    return isinstance(event, OrderEvent)

def is_trade_event(event: UserEvent) -> bool:
    return isinstance(event, TradeEvent)

def is_balance_event(event: UserEvent) -> bool:
    return isinstance(event, BalanceEvent)