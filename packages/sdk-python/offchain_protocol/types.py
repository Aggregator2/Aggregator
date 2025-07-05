from enum import Enum
from typing import List, Dict, Optional, Any, Union
from datetime import datetime
from pydantic import BaseModel, Field


class OrderSide(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_LIMIT = "stop_limit"


class OrderStatus(str, Enum):
    PENDING = "pending"
    OPEN = "open"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"
    EXPIRED = "expired"


class TimeInForce(str, Enum):
    GTC = "gtc"  # Good Till Cancelled
    IOC = "ioc"  # Immediate Or Cancel
    FOK = "fok"  # Fill Or Kill
    GTT = "gtt"  # Good Till Time


class SettlementStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class CandleInterval(str, Enum):
    ONE_MINUTE = "1m"
    FIVE_MINUTES = "5m"
    FIFTEEN_MINUTES = "15m"
    THIRTY_MINUTES = "30m"
    ONE_HOUR = "1h"
    FOUR_HOURS = "4h"
    ONE_DAY = "1d"
    ONE_WEEK = "1w"


class NotificationType(str, Enum):
    ORDER = "order"
    TRADE = "trade"
    SETTLEMENT = "settlement"
    SYSTEM = "system"


class NotificationPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class Order(BaseModel):
    id: str
    user_id: str = Field(alias="userId")
    pair: str
    side: OrderSide
    type: OrderType
    price: str
    quantity: str
    filled_quantity: str = Field(alias="filledQuantity")
    status: OrderStatus
    time_in_force: TimeInForce = Field(alias="timeInForce")
    stop_price: Optional[str] = Field(None, alias="stopPrice")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    expires_at: Optional[datetime] = Field(None, alias="expiresAt")
    metadata: Optional[Dict[str, Any]] = None

    class Config:
        populate_by_name = True


class CreateOrderRequest(BaseModel):
    pair: str
    side: OrderSide
    type: OrderType
    quantity: str
    price: Optional[str] = None
    stop_price: Optional[str] = Field(None, alias="stopPrice")
    time_in_force: Optional[TimeInForce] = Field(TimeInForce.GTC, alias="timeInForce")
    expires_at: Optional[datetime] = Field(None, alias="expiresAt")
    metadata: Optional[Dict[str, Any]] = None

    class Config:
        populate_by_name = True


class UpdateOrderRequest(BaseModel):
    price: Optional[str] = None
    quantity: Optional[str] = None
    stop_price: Optional[str] = Field(None, alias="stopPrice")

    class Config:
        populate_by_name = True


class OrderBookLevel(BaseModel):
    price: str
    quantity: str
    order_count: int = Field(alias="orderCount")

    class Config:
        populate_by_name = True


class OrderBook(BaseModel):
    pair: str
    bids: List[OrderBookLevel]
    asks: List[OrderBookLevel]
    timestamp: datetime
    sequence_number: int = Field(alias="sequenceNumber")

    class Config:
        populate_by_name = True


class Trade(BaseModel):
    id: str
    pair: str
    price: str
    quantity: str
    side: OrderSide  # Taker side
    buy_order_id: str = Field(alias="buyOrderId")
    sell_order_id: str = Field(alias="sellOrderId")
    buyer_user_id: str = Field(alias="buyerUserId")
    seller_user_id: str = Field(alias="sellerUserId")
    fee: str
    timestamp: datetime

    class Config:
        populate_by_name = True


class Settlement(BaseModel):
    id: str
    epoch_id: str = Field(alias="epochId")
    user_id: str = Field(alias="userId")
    currency: str
    amount: str
    status: SettlementStatus
    tx_hash: Optional[str] = Field(None, alias="txHash")
    block_number: Optional[int] = Field(None, alias="blockNumber")
    merkle_proof: Optional[List[str]] = Field(None, alias="merkleProof")
    created_at: datetime = Field(alias="createdAt")
    completed_at: Optional[datetime] = Field(None, alias="completedAt")

    class Config:
        populate_by_name = True


class SettlementProof(BaseModel):
    epoch_id: str = Field(alias="epochId")
    user_id: str = Field(alias="userId")
    currency: str
    amount: str
    merkle_proof: List[str] = Field(alias="merkleProof")
    merkle_root: str = Field(alias="merkleRoot")
    leaf_index: int = Field(alias="leafIndex")

    class Config:
        populate_by_name = True


class Ticker(BaseModel):
    pair: str
    last_price: str = Field(alias="lastPrice")
    bid_price: str = Field(alias="bidPrice")
    ask_price: str = Field(alias="askPrice")
    base_volume_24h: str = Field(alias="baseVolume24h")
    quote_volume_24h: str = Field(alias="quoteVolume24h")
    price_change_24h: str = Field(alias="priceChange24h")
    price_change_percent_24h: str = Field(alias="priceChangePercent24h")
    high_24h: str = Field(alias="high24h")
    low_24h: str = Field(alias="low24h")
    open_price_24h: str = Field(alias="openPrice24h")
    trades_24h: int = Field(alias="trades24h")
    timestamp: datetime

    class Config:
        populate_by_name = True


class Candle(BaseModel):
    pair: str
    interval: CandleInterval
    open_time: datetime = Field(alias="openTime")
    close_time: datetime = Field(alias="closeTime")
    open: str
    high: str
    low: str
    close: str
    volume: str
    quote_volume: str = Field(alias="quoteVolume")
    trades: int

    class Config:
        populate_by_name = True


class Notification(BaseModel):
    id: str
    type: NotificationType
    title: str
    message: str
    data: Optional[Dict[str, Any]] = None
    priority: NotificationPriority
    timestamp: datetime

    class Config:
        populate_by_name = True


class ApiResponse(BaseModel):
    data: Any
    success: bool
    timestamp: datetime


class PaginatedResponse(ApiResponse):
    pagination: Dict[str, Union[int, bool]]


class RateLimitInfo(BaseModel):
    limit: int
    remaining: int
    reset: datetime
    retry_after: Optional[int] = Field(None, alias="retryAfter")

    class Config:
        populate_by_name = True