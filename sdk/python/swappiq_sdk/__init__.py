"""
SwappiQ Protocol Python SDK
Author: SwappiQ Protocol
Description: Production-ready Python SDK for SwappiQ decentralized exchange

This SDK provides comprehensive access to:
- Trading operations (orders, trades, balances)
- Market data (order books, tickers, candles)
- Real-time WebSocket streams
- Request signing and authentication
- Local order validation
- Automatic retry and rate limiting
"""

import asyncio
import logging
import time
from typing import Dict, List, Optional, Union, Callable, Any
from urllib.parse import urljoin

from .types import *
from .http_client import HttpClient, RequestOptions
from .websocket_client import SwappiQWebSocket
from .order_validator import OrderValidator, ValidationContext, OrderValidationOptions
from .request_signer import RequestSigner
from .rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

class SwappiQClient:
    """Main SwappiQ Protocol SDK Client
    
    Provides comprehensive access to trading, market data, and account management APIs
    """
    
    def __init__(self, config: Dict[str, Any]):
        """Initialize SwappiQ client
        
        Args:
            config: Configuration dictionary with keys:
                - api_url: API base URL
                - ws_url: WebSocket URL (optional)
                - auth: Authentication credentials (optional)
                - network: Blockchain network (default: ethereum)
                - timeout: Request timeout (default: 30.0)
                - retry_config: Retry configuration (optional)
                - rate_limit_config: Rate limiting configuration (optional)
                - debug: Enable debug logging (default: False)
        """
        # Set up default configuration
        self.config = SDKConfig(
            api_url=config['api_url'],
            ws_url=config.get('ws_url'),
            auth=AuthCredentials(**config['auth']) if config.get('auth') else None,
            network=Network(config.get('network', 'ethereum')),
            timeout=config.get('timeout', 30.0),
            retry_config=RetryConfig(**config.get('retry_config', {})),
            rate_limit_config=RateLimitConfig(**config['rate_limit_config']) if config.get('rate_limit_config') else None,
            debug=config.get('debug', False)
        )
        
        # Initialize HTTP client
        self.http_client = HttpClient(self.config)
        
        # Initialize WebSocket client if URL provided
        self.ws_client: Optional[SwappiQWebSocket] = None
        if self.config.ws_url:
            ws_config = WebSocketConfig(
                url=self.config.ws_url,
                auth=self.config.auth,
                reconnect_interval=5000,
                max_reconnect_attempts=10,
                ping_interval=30000
            )
            self.ws_client = SwappiQWebSocket(ws_config)
            self._setup_websocket_event_handlers()
        
        # Initialize request signer
        self.request_signer = RequestSigner(self.config.auth) if self.config.auth else None
        
        # State management
        self.trading_pairs: Dict[str, TradingPair] = {}
        self.balances: Dict[str, Balance] = {}
        self.initialized = False
        
        # Initialize order validator with empty context (will be populated on init)
        self.order_validator = OrderValidator(ValidationContext(
            trading_pairs=self.trading_pairs,
            balances=self.balances,
            network_fees={
                'gasPrice': '20000000000',  # 20 gwei default
                'gasLimit': '100000'
            },
            risk_limits={
                'maxOrderValue': '100000',  # $100k default
                'maxDailyVolume': '1000000',  # $1M default
                'maxOpenOrders': 50
            }
        ))
    
    async def initialize(self) -> None:
        """Initialize the SDK client"""
        try:
            # Load initial data
            await asyncio.gather(
                self._load_trading_pairs(),
                self._load_user_balances()
            )
            
            # Connect WebSocket if available
            if self.ws_client:
                await self.ws_client.connect()
            
            self.initialized = True
            logger.info("SwappiQ SDK initialized successfully")
            
        except Exception as error:
            logger.error(f"Failed to initialize SDK: {error}")
            raise
    
    # ========== TRADING METHODS ==========
    
    async def create_order(self, request: CreateOrderRequest, options: Optional[OrderValidationOptions] = None) -> CreateOrderResponse:
        """Create a new order"""
        self._ensure_initialized()
        
        # Validate order locally first
        validation = await self.order_validator.validate_create_order(request, options)
        
        if not validation.balance_sufficient and not (options and options.skip_balance_check):
            raise ValueError('Insufficient balance for order')
        
        if validation.errors:
            raise ValueError(f'Order validation failed: {validation.errors[0].message}')
        
        # Submit order to API
        response = await self.http_client.request(RequestOptions(
            method='POST',
            path='/orders',
            body=request.__dict__,
            auth=True
        ))
        
        if response.success and response.data:
            order_data = response.data.get('order')
            if order_data:
                # TODO: Convert response to Order object
                logger.info(f"Order created: {order_data.get('id')}")
        
        return CreateOrderResponse(**response.data) if response.data else CreateOrderResponse(success=False)
    
    async def cancel_order(self, order_id: str) -> ApiResponse:
        """Cancel an existing order"""
        self._ensure_initialized()
        
        response = await self.http_client.request(RequestOptions(
            method='DELETE',
            path=f'/orders/{order_id}',
            auth=True
        ))
        
        if response.success and response.data:
            logger.info(f"Order cancelled: {order_id}")
        
        return response
    
    async def get_order(self, order_id: str) -> Order:
        """Get order by ID"""
        self._ensure_initialized()
        
        response = await self.http_client.request(RequestOptions(
            method='GET',
            path=f'/orders/{order_id}',
            auth=True
        ))
        
        if not response.success or not response.data:
            raise Exception(f"Failed to get order: {response.error.message if response.error else 'Unknown error'}")
        
        # TODO: Convert response to Order object
        return response.data
    
    async def get_order_history(self, params: Optional[OrderHistoryParams] = None) -> PaginatedResponse:
        """Get order history"""
        self._ensure_initialized()
        
        query_params = {}
        if params:
            if params.trading_pair:
                query_params['trading_pair'] = params.trading_pair
            if params.status:
                query_params['status'] = ','.join([s.value for s in params.status])
            if params.side:
                query_params['side'] = params.side.value
            if params.start_time:
                query_params['start_time'] = params.start_time.isoformat()
            if params.end_time:
                query_params['end_time'] = params.end_time.isoformat()
            if params.page:
                query_params['page'] = str(params.page)
            if params.limit:
                query_params['limit'] = str(params.limit)
        
        query_string = '&'.join([f'{k}={v}' for k, v in query_params.items()])
        path = f'/orders?{query_string}' if query_string else '/orders'
        
        response = await self.http_client.request(RequestOptions(
            method='GET',
            path=path,
            auth=True
        ))
        
        if not response.success or not response.data:
            raise Exception(f"Failed to get order history: {response.error.message if response.error else 'Unknown error'}")
        
        return PaginatedResponse(**response.data)
    
    async def get_trade_history(self, params: Optional[TradeHistoryParams] = None) -> PaginatedResponse:
        """Get trade history"""
        self._ensure_initialized()
        
        query_params = {}
        if params:
            if params.trading_pair:
                query_params['trading_pair'] = params.trading_pair
            if params.start_time:
                query_params['start_time'] = params.start_time.isoformat()
            if params.end_time:
                query_params['end_time'] = params.end_time.isoformat()
            if params.page:
                query_params['page'] = str(params.page)
            if params.limit:
                query_params['limit'] = str(params.limit)
        
        query_string = '&'.join([f'{k}={v}' for k, v in query_params.items()])
        path = f'/trades?{query_string}' if query_string else '/trades'
        
        response = await self.http_client.request(RequestOptions(
            method='GET',
            path=path,
            auth=True
        ))
        
        if not response.success or not response.data:
            raise Exception(f"Failed to get trade history: {response.error.message if response.error else 'Unknown error'}")
        
        return PaginatedResponse(**response.data)
    
    # ========== MARKET DATA METHODS ==========
    
    async def get_trading_pairs(self) -> List[TradingPair]:
        """Get all trading pairs"""
        response = await self.http_client.request(RequestOptions(
            method='GET',
            path='/trading-pairs'
        ))
        
        if not response.success or not response.data:
            raise Exception(f"Failed to get trading pairs: {response.error.message if response.error else 'Unknown error'}")
        
        # TODO: Convert response to TradingPair objects
        return response.data
    
    async def get_order_book(self, trading_pair: str, depth: int = 20) -> OrderBook:
        """Get order book for trading pair"""
        response = await self.http_client.request(RequestOptions(
            method='GET',
            path=f'/orderbook/{trading_pair}?depth={depth}'
        ))
        
        if not response.success or not response.data:
            raise Exception(f"Failed to get order book: {response.error.message if response.error else 'Unknown error'}")
        
        # TODO: Convert response to OrderBook object
        return response.data
    
    async def get_market_stats(self, trading_pair: Optional[str] = None) -> List[MarketStats]:
        """Get market statistics"""
        path = f'/market/stats/{trading_pair}' if trading_pair else '/market/stats'
        
        response = await self.http_client.request(RequestOptions(
            method='GET',
            path=path
        ))
        
        if not response.success or not response.data:
            raise Exception(f"Failed to get market stats: {response.error.message if response.error else 'Unknown error'}")
        
        # TODO: Convert response to MarketStats objects
        return response.data
    
    async def get_ticker(self, trading_pair: str) -> Ticker:
        """Get price ticker"""
        response = await self.http_client.request(RequestOptions(
            method='GET',
            path=f'/ticker/{trading_pair}'
        ))
        
        if not response.success or not response.data:
            raise Exception(f"Failed to get ticker: {response.error.message if response.error else 'Unknown error'}")
        
        # TODO: Convert response to Ticker object
        return response.data
    
    async def get_candles(self, params: CandleParams) -> List[Candle]:
        """Get candlestick data"""
        query_params = {
            'interval': params.interval
        }
        if params.start_time:
            query_params['start_time'] = params.start_time.isoformat()
        if params.end_time:
            query_params['end_time'] = params.end_time.isoformat()
        if params.limit:
            query_params['limit'] = str(params.limit)
        
        query_string = '&'.join([f'{k}={v}' for k, v in query_params.items()])
        
        response = await self.http_client.request(RequestOptions(
            method='GET',
            path=f'/candles/{params.trading_pair}?{query_string}'
        ))
        
        if not response.success or not response.data:
            raise Exception(f"Failed to get candles: {response.error.message if response.error else 'Unknown error'}")
        
        # TODO: Convert response to Candle objects
        return response.data
    
    # ========== ACCOUNT METHODS ==========
    
    async def get_balances(self) -> List[Balance]:
        """Get user balances"""
        self._ensure_initialized()
        
        response = await self.http_client.request(RequestOptions(
            method='GET',
            path='/account/balances',
            auth=True
        ))
        
        if not response.success or not response.data:
            raise Exception(f"Failed to get balances: {response.error.message if response.error else 'Unknown error'}")
        
        # Update local cache
        self.balances.clear()
        for balance_data in response.data:
            # TODO: Convert to Balance object
            balance = balance_data  # Placeholder
            self.balances[balance['token']['value']] = balance
        
        return response.data
    
    async def get_portfolio(self) -> Portfolio:
        """Get portfolio summary"""
        self._ensure_initialized()
        
        response = await self.http_client.request(RequestOptions(
            method='GET',
            path='/account/portfolio',
            auth=True
        ))
        
        if not response.success or not response.data:
            raise Exception(f"Failed to get portfolio: {response.error.message if response.error else 'Unknown error'}")
        
        # TODO: Convert response to Portfolio object
        return response.data
    
    # ========== WEBSOCKET METHODS ==========
    
    async def subscribe_to_order_book(self, trading_pairs: Union[str, List[str]]) -> None:
        """Subscribe to order book updates"""
        if not self.ws_client:
            raise Exception('WebSocket client not available')
        
        pairs = [trading_pairs] if isinstance(trading_pairs, str) else trading_pairs
        await self.ws_client.subscribe_to_order_book(pairs)
    
    async def subscribe_to_trades(self, trading_pairs: Union[str, List[str]]) -> None:
        """Subscribe to trade updates"""
        if not self.ws_client:
            raise Exception('WebSocket client not available')
        
        pairs = [trading_pairs] if isinstance(trading_pairs, str) else trading_pairs
        await self.ws_client.subscribe_to_trades(pairs)
    
    async def subscribe_to_user_events(self) -> None:
        """Subscribe to user events"""
        if not self.ws_client:
            raise Exception('WebSocket client not available')
        
        await self.ws_client.subscribe_to_user_events()
    
    def on_order_book_update(self, handler: Callable[[OrderBook], None]) -> None:
        """Handle order book updates"""
        if not self.ws_client:
            raise Exception('WebSocket client not available')
        
        self.ws_client.on_order_book_update(handler)
    
    def on_trade_update(self, handler: Callable[[Trade], None]) -> None:
        """Handle trade updates"""
        if not self.ws_client:
            raise Exception('WebSocket client not available')
        
        self.ws_client.on_trade_update(handler)
    
    def on_user_event(self, handler: Callable[[UserEvent], None]) -> None:
        """Handle user events"""
        if not self.ws_client:
            raise Exception('WebSocket client not available')
        
        self.ws_client.on_user_event(handler)
    
    # ========== VALIDATION METHODS ==========
    
    async def validate_order(self, request: CreateOrderRequest, options: Optional[OrderValidationOptions] = None) -> OrderValidation:
        """Validate order before submission"""
        return await self.order_validator.validate_create_order(request, options)
    
    async def update_validation_context(self) -> None:
        """Update validation context with fresh data"""
        await asyncio.gather(
            self._load_trading_pairs(),
            self._load_user_balances()
        )
    
    # ========== UTILITY METHODS ==========
    
    def get_stats(self) -> Dict[str, Any]:
        """Get client statistics"""
        stats = {
            'http': self.http_client.get_stats(),
            'trading_pairs': len(self.trading_pairs),
            'balances': len(self.balances)
        }
        
        if self.ws_client:
            stats['websocket'] = self.ws_client.get_stats()
        
        return stats
    
    def is_healthy(self) -> bool:
        """Check if client is healthy"""
        http_healthy = self.http_client.is_healthy()
        ws_healthy = self.ws_client.is_healthy() if self.ws_client else True
        
        return self.initialized and http_healthy and ws_healthy
    
    async def shutdown(self) -> None:
        """Gracefully shutdown the client"""
        if self.ws_client:
            await self.ws_client.shutdown()
        
        await self.http_client.close()
        logger.info("SwappiQ SDK shutdown completed")
    
    # ========== PRIVATE METHODS ==========
    
    async def _load_trading_pairs(self) -> None:
        """Load trading pairs and update local cache"""
        try:
            trading_pairs = await self.get_trading_pairs()
            
            self.trading_pairs.clear()
            for pair in trading_pairs:
                self.trading_pairs[pair['symbol']] = pair
            
            self.order_validator.update_context({'trading_pairs': self.trading_pairs})
            
        except Exception as error:
            logger.warning(f"Failed to load trading pairs: {error}")
    
    async def _load_user_balances(self) -> None:
        """Load user balances if authenticated"""
        if not self.config.auth:
            return
        
        try:
            await self.get_balances()
            self.order_validator.update_context({'balances': self.balances})
            
        except Exception as error:
            logger.warning(f"Failed to load user balances: {error}")
    
    def _setup_websocket_event_handlers(self) -> None:
        """Set up WebSocket event handlers"""
        if not self.ws_client:
            return
        
        self.ws_client.on('connected', lambda: logger.info('WebSocket connected'))
        self.ws_client.on('disconnected', lambda event: logger.info(f'WebSocket disconnected: {event.get("reason")}'))
        self.ws_client.on('error', lambda error: logger.error(f'WebSocket error: {error}'))
        self.ws_client.on('reconnecting', lambda event: logger.info(f'WebSocket reconnecting (attempt {event.get("attempt")})'))
    
    def _ensure_initialized(self) -> None:
        """Ensure client is initialized"""
        if not self.initialized:
            raise Exception('Client not initialized. Call initialize() first.')

# ========== CONVENIENCE FUNCTIONS ==========

def create_client(config: Dict[str, Any]) -> SwappiQClient:
    """Create a SwappiQ client with the given configuration"""
    return SwappiQClient(config)

async def create_and_initialize_client(config: Dict[str, Any]) -> SwappiQClient:
    """Create and initialize a SwappiQ client"""
    client = SwappiQClient(config)
    await client.initialize()
    return client

# ========== EXPORTS ==========

__all__ = [
    # Main client
    'SwappiQClient',
    'create_client',
    'create_and_initialize_client',
    
    # Types
    'Network', 'OrderSide', 'OrderType', 'OrderStatus', 'TimeInForce',
    'Address', 'DecimalAmount', 'TokenAmount',
    'CreateOrderRequest', 'Order', 'TradingPair', 'OrderBook', 'Trade',
    'Balance', 'Portfolio', 'MarketStats', 'Ticker', 'Candle',
    'AuthCredentials', 'WebSocketConfig', 'SDKConfig',
    'ValidationError', 'ValidationResult', 'OrderValidation',
    'PaginationParams', 'OrderHistoryParams', 'TradeHistoryParams', 'CandleParams',
    
    # Components
    'HttpClient', 'SwappiQWebSocket', 'OrderValidator', 'RequestSigner', 'RateLimiter',
    
    # Type checking
    'is_limit_order', 'is_market_order', 'is_stop_order', 'is_stop_limit_order',
    'is_order_event', 'is_trade_event', 'is_balance_event'
]