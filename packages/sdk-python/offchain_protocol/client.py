"""
Offchain Protocol Python SDK Client
"""
import asyncio
import hashlib
import hmac
import json
import time
from typing import Optional, Dict, Any, List, AsyncIterator, Union
from urllib.parse import urljoin

import aiohttp
from aiohttp import ClientTimeout, ClientError

from .types import (
    Order,
    CreateOrderRequest,
    UpdateOrderRequest,
    OrderBook,
    Trade,
    Settlement,
    SettlementProof,
    Ticker,
    Candle,
    CandleInterval,
    OrderStatus,
    SettlementStatus,
    PaginatedResponse,
    RateLimitInfo,
)
from .exceptions import (
    AuthenticationError,
    ApiError,
    RateLimitError,
    NetworkError,
    TimeoutError,
    ValidationError,
)
from .websocket import WebSocketClient


class OffchainClient:
    """
    Async client for Offchain Protocol API
    
    Example:
        >>> client = OffchainClient('your-api-key', testnet=True)
        >>> order = await client.create_order(CreateOrderRequest(
        ...     pair='BTC/USDT',
        ...     side='buy',
        ...     type='limit',
        ...     quantity='0.1',
        ...     price='45000'
        ... ))
    """
    
    def __init__(
        self,
        api_key: str,
        api_secret: Optional[str] = None,
        testnet: bool = False,
        base_url: Optional[str] = None,
        websocket_url: Optional[str] = None,
        timeout: int = 30,
        session: Optional[aiohttp.ClientSession] = None
    ):
        self.api_key = api_key
        self.api_secret = api_secret
        self.testnet = testnet
        
        if base_url:
            self.base_url = base_url
        else:
            self.base_url = (
                "https://api.testnet.offchain.finance"
                if testnet
                else "https://api.offchain.finance"
            )
        
        if websocket_url:
            self.websocket_url = websocket_url
        else:
            self.websocket_url = (
                "wss://ws.testnet.offchain.finance"
                if testnet
                else "wss://ws.offchain.finance"
            )
        
        self.timeout = ClientTimeout(total=timeout)
        self._session = session
        self._owned_session = session is None
        self._rate_limit_info: Optional[RateLimitInfo] = None
        self._websocket_client: Optional[WebSocketClient] = None
    
    async def __aenter__(self):
        if self._owned_session:
            self._session = aiohttp.ClientSession(timeout=self.timeout)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
    
    async def close(self):
        """Close the client session"""
        if self._websocket_client:
            await self._websocket_client.close()
        
        if self._owned_session and self._session:
            await self._session.close()
    
    def _sign_request(self, method: str, path: str, data: Optional[str] = None) -> Dict[str, str]:
        """Sign request with HMAC-SHA256"""
        if not self.api_secret:
            return {}
        
        timestamp = str(int(time.time() * 1000))
        nonce = str(int(time.time() * 1000000))
        
        payload = f"{timestamp}{nonce}{method.upper()}{path}{data or ''}"
        signature = hmac.new(
            self.api_secret.encode(),
            payload.encode(),
            hashlib.sha256
        ).hexdigest()
        
        return {
            "X-TIMESTAMP": timestamp,
            "X-NONCE": nonce,
            "X-SIGNATURE": signature,
        }
    
    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json_data: Optional[Dict[str, Any]] = None
    ) -> Any:
        """Make authenticated API request"""
        if not self._session:
            raise RuntimeError("Client session not initialized. Use async context manager.")
        
        url = urljoin(self.base_url, path)
        headers = {
            "X-API-KEY": self.api_key,
            "Content-Type": "application/json",
        }
        
        # Add signature headers
        data_str = json.dumps(json_data) if json_data else None
        headers.update(self._sign_request(method, path, data_str))
        
        try:
            async with self._session.request(
                method,
                url,
                headers=headers,
                params=params,
                json=json_data
            ) as response:
                # Update rate limit info
                self._update_rate_limit_info(response.headers)
                
                # Handle rate limiting
                if response.status == 429:
                    retry_after = int(response.headers.get("Retry-After", 60))
                    raise RateLimitError(retry_after=retry_after)
                
                # Handle authentication errors
                if response.status == 401:
                    raise AuthenticationError()
                
                # Handle other errors
                if response.status >= 400:
                    try:
                        error_data = await response.json()
                        raise ApiError(
                            error_data.get("message", "API request failed"),
                            error_data.get("code", "API_ERROR"),
                            response.status,
                            error_data
                        )
                    except (json.JSONDecodeError, KeyError):
                        raise ApiError(
                            f"API request failed with status {response.status}",
                            "API_ERROR",
                            response.status
                        )
                
                return await response.json()
        
        except asyncio.TimeoutError:
            raise TimeoutError()
        except ClientError as e:
            raise NetworkError(str(e))
    
    def _update_rate_limit_info(self, headers: Dict[str, str]):
        """Update rate limit info from response headers"""
        limit = headers.get("X-RateLimit-Limit")
        remaining = headers.get("X-RateLimit-Remaining")
        reset = headers.get("X-RateLimit-Reset")
        
        if limit and remaining and reset:
            from datetime import datetime
            self._rate_limit_info = RateLimitInfo(
                limit=int(limit),
                remaining=int(remaining),
                reset=datetime.fromtimestamp(int(reset))
            )
    
    # Orders API
    
    async def create_order(self, order: CreateOrderRequest) -> Order:
        """Create a new order"""
        response = await self._request("POST", "/orders", json_data=order.dict(by_alias=True))
        return Order(**response["data"])
    
    async def get_order(self, order_id: str) -> Order:
        """Get order by ID"""
        response = await self._request("GET", f"/orders/{order_id}")
        return Order(**response["data"])
    
    async def list_orders(
        self,
        pair: Optional[str] = None,
        status: Optional[Union[OrderStatus, List[OrderStatus]]] = None,
        limit: int = 20,
        offset: int = 0
    ) -> PaginatedResponse:
        """List orders with filtering"""
        params = {"limit": limit, "offset": offset}
        if pair:
            params["pair"] = pair
        if status:
            if isinstance(status, list):
                params["status"] = ",".join(s.value for s in status)
            else:
                params["status"] = status.value
        
        response = await self._request("GET", "/orders", params=params)
        response["data"] = [Order(**order) for order in response["data"]]
        return PaginatedResponse(**response)
    
    async def update_order(self, order_id: str, update: UpdateOrderRequest) -> Order:
        """Update an existing order"""
        response = await self._request(
            "PUT",
            f"/orders/{order_id}",
            json_data=update.dict(by_alias=True, exclude_none=True)
        )
        return Order(**response["data"])
    
    async def cancel_order(self, order_id: str) -> Order:
        """Cancel an order"""
        response = await self._request("DELETE", f"/orders/{order_id}")
        return Order(**response["data"])
    
    async def cancel_all_orders(self, pair: Optional[str] = None) -> Dict[str, Any]:
        """Cancel all orders"""
        params = {"pair": pair} if pair else None
        response = await self._request("DELETE", "/orders", params=params)
        return response["data"]
    
    # Order Book API
    
    async def get_orderbook(self, pair: str, depth: int = 20) -> OrderBook:
        """Get order book for a trading pair"""
        if not pair:
            raise ValidationError("Trading pair is required")
        
        response = await self._request("GET", f"/orderbook/{pair}", params={"depth": depth})
        return OrderBook(**response["data"])
    
    # Trades API
    
    async def get_recent_trades(self, pair: str, limit: int = 50) -> List[Trade]:
        """Get recent trades for a pair"""
        response = await self._request(
            "GET",
            f"/trades/{pair}/recent",
            params={"limit": limit}
        )
        return [Trade(**trade) for trade in response["data"]]
    
    async def get_user_trades(
        self,
        pair: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> PaginatedResponse:
        """Get user's trade history"""
        params = {"limit": limit, "offset": offset}
        if pair:
            params["pair"] = pair
        
        response = await self._request("GET", "/trades/my", params=params)
        response["data"] = [Trade(**trade) for trade in response["data"]]
        return PaginatedResponse(**response)
    
    # Settlements API
    
    async def list_settlements(
        self,
        status: Optional[SettlementStatus] = None,
        currency: Optional[str] = None,
        limit: int = 20,
        offset: int = 0
    ) -> PaginatedResponse:
        """List user's settlements"""
        params = {"limit": limit, "offset": offset}
        if status:
            params["status"] = status.value
        if currency:
            params["currency"] = currency
        
        response = await self._request("GET", "/settlements", params=params)
        response["data"] = [Settlement(**s) for s in response["data"]]
        return PaginatedResponse(**response)
    
    async def get_settlement(self, settlement_id: str) -> Settlement:
        """Get settlement by ID"""
        response = await self._request("GET", f"/settlements/{settlement_id}")
        return Settlement(**response["data"])
    
    async def get_settlement_proof(self, settlement_id: str) -> SettlementProof:
        """Get settlement proof"""
        response = await self._request("GET", f"/settlements/{settlement_id}/proof")
        return SettlementProof(**response["data"])
    
    # Market Data API
    
    async def get_ticker(self, pair: str) -> Ticker:
        """Get ticker for a trading pair"""
        response = await self._request("GET", f"/ticker/{pair}")
        return Ticker(**response["data"])
    
    async def get_candles(
        self,
        pair: str,
        interval: CandleInterval,
        limit: int = 100
    ) -> List[Candle]:
        """Get candlestick data"""
        response = await self._request(
            "GET",
            f"/candles/{pair}",
            params={"interval": interval.value, "limit": limit}
        )
        return [Candle(**candle) for candle in response["data"]]
    
    # WebSocket Streaming
    
    async def stream_trades(self, pair: str) -> AsyncIterator[Trade]:
        """Stream trades for a pair"""
        if not self._websocket_client:
            self._websocket_client = WebSocketClient(
                self.websocket_url,
                self.api_key
            )
            await self._websocket_client.connect()
        
        await self._websocket_client.subscribe_trades([pair])
        
        async for trade_data in self._websocket_client.stream_trades(pair):
            yield Trade(**trade_data)
    
    async def stream_orderbook(self, pair: str) -> AsyncIterator[OrderBook]:
        """Stream order book updates"""
        if not self._websocket_client:
            self._websocket_client = WebSocketClient(
                self.websocket_url,
                self.api_key
            )
            await self._websocket_client.connect()
        
        await self._websocket_client.subscribe_orderbook([pair])
        
        async for orderbook_data in self._websocket_client.stream_orderbook(pair):
            yield OrderBook(**orderbook_data)
    
    async def stream_orders(self) -> AsyncIterator[Order]:
        """Stream user's order updates"""
        if not self._websocket_client:
            self._websocket_client = WebSocketClient(
                self.websocket_url,
                self.api_key
            )
            await self._websocket_client.connect()
        
        await self._websocket_client.subscribe_orders()
        
        async for order_data in self._websocket_client.stream_orders():
            yield Order(**order_data)
    
    @property
    def rate_limit_info(self) -> Optional[RateLimitInfo]:
        """Get current rate limit info"""
        return self._rate_limit_info