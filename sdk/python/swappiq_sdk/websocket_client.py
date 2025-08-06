"""
WebSocket client with automatic reconnection and subscription management
Author: SwappiQ Protocol
Description: Production-grade WebSocket client with comprehensive error handling, reconnection logic, and real-time data streaming
"""

import asyncio
import json
import logging
import time
import ssl
from typing import Dict, List, Optional, Callable, Any, Set
from dataclasses import dataclass, field
from enum import Enum
import websockets
from websockets.exceptions import ConnectionClosed, InvalidURI, SecurityError

from .types import (
    WebSocketConfig, WebSocketMessage, SubscriptionRequest, 
    AuthCredentials, OrderBook, Trade, UserEvent,
    OrderBookUpdate, Network
)
from .request_signer import RequestSigner

logger = logging.getLogger(__name__)

class ConnectionState(Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    ERROR = "error"

@dataclass
class ConnectionInfo:
    state: ConnectionState = ConnectionState.DISCONNECTED
    last_connected: Optional[float] = None
    reconnect_attempts: int = 0
    subscriptions: Set[str] = field(default_factory=set)
    authenticated: bool = False

@dataclass
class WebSocketStats:
    messages_received: int = 0
    messages_sent: int = 0
    reconnection_count: int = 0
    connection_uptime: float = 0
    average_latency: float = 0
    subscription_count: int = 0
    error_count: int = 0

@dataclass
class MessageHandler:
    channel: str
    handler: Callable[[Any, Dict[str, Any]], None]

class WebSocketClient:
    """Enterprise-grade WebSocket client with comprehensive features"""
    
    def __init__(self, config: WebSocketConfig):
        self.config = config
        self.request_signer = RequestSigner(config.auth) if config.auth else None
        
        # Connection state
        self.connection_info = ConnectionInfo()
        self.websocket: Optional[websockets.WebSocketClientProtocol] = None
        self.reconnect_task: Optional[asyncio.Task] = None
        self.ping_task: Optional[asyncio.Task] = None
        
        # Message handling
        self.message_handlers: Dict[str, List[MessageHandler]] = {}
        self.pending_subscriptions: Set[str] = set()
        self.message_queue: List[Dict[str, Any]] = []
        
        # Statistics and monitoring
        self.stats = WebSocketStats()
        self.last_ping_time = 0.0
        self.latency_measurements: List[float] = []
        
        # Event handlers
        self.event_handlers: Dict[str, List[Callable]] = {
            'connected': [],
            'disconnected': [],
            'error': [],
            'message': [],
            'reconnecting': [],
            'authenticated': []
        }
    
    async def connect(self) -> None:
        """Connect to WebSocket server"""
        if self.connection_info.state in [ConnectionState.CONNECTED, ConnectionState.CONNECTING]:
            return
            
        self.connection_info.state = ConnectionState.CONNECTING
        self._emit_event('connecting')
        
        try:
            await self._create_connection()
        except Exception as error:
            await self._handle_connection_error(error)
            raise
    
    async def disconnect(self) -> None:
        """Disconnect from WebSocket server"""
        await self._cleanup_tasks()
        
        if self.websocket:
            await self.websocket.close()
            self.websocket = None
            
        self.connection_info.state = ConnectionState.DISCONNECTED
        self.connection_info.authenticated = False
        self._emit_event('disconnected', {'reason': 'client_disconnect'})
    
    async def subscribe(self, channels: List[str], trading_pairs: Optional[List[str]] = None, auth: bool = False) -> None:
        """Subscribe to channels"""
        # Add to subscriptions set
        for channel in channels:
            self.connection_info.subscriptions.add(channel)
            self.pending_subscriptions.add(channel)
        
        # If connected, send subscription immediately
        if self.connection_info.state == ConnectionState.CONNECTED:
            await self._send_subscription_request('subscribe', channels, trading_pairs, auth)
            
        self.stats.subscription_count = len(self.connection_info.subscriptions)
    
    async def unsubscribe(self, channels: List[str]) -> None:
        """Unsubscribe from channels"""
        # Remove from subscriptions set
        for channel in channels:
            self.connection_info.subscriptions.discard(channel)
            self.pending_subscriptions.discard(channel)
        
        # If connected, send unsubscription
        if self.connection_info.state == ConnectionState.CONNECTED:
            await self._send_subscription_request('unsubscribe', channels)
            
        self.stats.subscription_count = len(self.connection_info.subscriptions)
    
    def on_message(self, channel: str, handler: Callable[[Any, Dict[str, Any]], None]) -> None:
        """Register message handler for specific channel"""
        if channel not in self.message_handlers:
            self.message_handlers[channel] = []
            
        self.message_handlers[channel].append(MessageHandler(channel=channel, handler=handler))
    
    def off_message(self, channel: str, handler: Optional[Callable] = None) -> None:
        """Remove message handler"""
        if channel not in self.message_handlers:
            return
            
        if handler:
            self.message_handlers[channel] = [
                h for h in self.message_handlers[channel] if h.handler != handler
            ]
        else:
            # Remove all handlers for channel
            del self.message_handlers[channel]
    
    async def send(self, message: Dict[str, Any]) -> None:
        """Send message to server"""
        if self.connection_info.state != ConnectionState.CONNECTED or not self.websocket:
            # Queue message for later sending
            self.message_queue.append(message)
            return
            
        try:
            serialized = json.dumps(message, separators=(',', ':'))
            await self.websocket.send(serialized)
            self.stats.messages_sent += 1
            self._emit_event('message_sent', message)
        except Exception as error:
            self._emit_event('error', error)
            raise
    
    def on(self, event: str, handler: Callable) -> None:
        """Register event handler"""
        if event in self.event_handlers:
            self.event_handlers[event].append(handler)
    
    def off(self, event: str, handler: Optional[Callable] = None) -> None:
        """Remove event handler"""
        if event not in self.event_handlers:
            return
            
        if handler:
            try:
                self.event_handlers[event].remove(handler)
            except ValueError:
                pass
        else:
            self.event_handlers[event].clear()
    
    def get_connection_state(self) -> ConnectionInfo:
        """Get current connection state"""
        return self.connection_info
    
    def get_stats(self) -> WebSocketStats:
        """Get WebSocket statistics"""
        uptime = 0.0
        if self.connection_info.last_connected:
            uptime = time.time() - self.connection_info.last_connected
            
        return WebSocketStats(
            messages_received=self.stats.messages_received,
            messages_sent=self.stats.messages_sent,
            reconnection_count=self.stats.reconnection_count,
            connection_uptime=uptime,
            average_latency=self._calculate_average_latency(),
            subscription_count=self.stats.subscription_count,
            error_count=self.stats.error_count
        )
    
    def is_healthy(self) -> bool:
        """Check if WebSocket is healthy"""
        return (
            self.connection_info.state == ConnectionState.CONNECTED and
            self.connection_info.authenticated == (self.config.auth is not None) and
            self.stats.error_count < 10
        )
    
    # ========== PRIVATE METHODS ==========
    
    async def _create_connection(self) -> None:
        """Create WebSocket connection"""
        try:
            # Configure SSL context for secure connections
            ssl_context = None
            if self.config.url.startswith('wss://'):
                ssl_context = ssl.create_default_context()
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
            
            # Connect with timeout
            self.websocket = await asyncio.wait_for(
                websockets.connect(
                    self.config.url,
                    ssl=ssl_context,
                    ping_interval=None,  # We'll handle pings manually
                    ping_timeout=None,
                    close_timeout=5,
                    max_size=2**20,  # 1MB max message size
                    compression=None
                ),
                timeout=10.0
            )
            
            await self._handle_open()
            
        except asyncio.TimeoutError:
            raise ConnectionError("WebSocket connection timeout")
        except (ConnectionClosed, InvalidURI, SecurityError) as e:
            raise ConnectionError(f"WebSocket connection failed: {e}")
    
    async def _handle_open(self) -> None:
        """Handle WebSocket open event"""
        self.connection_info.state = ConnectionState.CONNECTED
        self.connection_info.last_connected = time.time()
        self.connection_info.reconnect_attempts = 0
        
        # Start background tasks
        await self._start_background_tasks()
        
        # Authenticate if credentials provided
        if self.config.auth:
            await self._authenticate()
        else:
            self.connection_info.authenticated = True
            
        # Re-subscribe to channels
        await self._resubscribe_channels()
        
        # Send queued messages
        await self._flush_message_queue()
        
        self._emit_event('connected')
    
    async def _handle_message(self, data: str) -> None:
        """Handle incoming WebSocket message"""
        try:
            message_data = json.loads(data)
            self.stats.messages_received += 1
            
            # Handle pong response for latency measurement
            if message_data.get('type') == 'pong':
                self._handle_pong()
                return
                
            # Handle authentication response
            if message_data.get('type') == 'auth_response':
                await self._handle_auth_response(message_data)
                return
                
            # Handle subscription confirmation
            if message_data.get('type') == 'subscription_confirmed':
                self._handle_subscription_confirmation(message_data)
                return
                
            # Route message to appropriate handlers
            await self._route_message(message_data)
            
            self._emit_event('message', message_data)
            
        except json.JSONDecodeError as e:
            self.stats.error_count += 1
            self._emit_event('parse_error', {'error': str(e), 'data': data})
        except Exception as e:
            self.stats.error_count += 1
            self._emit_event('error', e)
    
    async def _handle_close(self, code: int, reason: str) -> None:
        """Handle WebSocket close event"""
        await self._cleanup_tasks()
        self.connection_info.state = ConnectionState.DISCONNECTED
        self.connection_info.authenticated = False
        
        self._emit_event('disconnected', {'code': code, 'reason': reason})
        
        # Attempt reconnection if not a clean close
        if code != 1000 and self.connection_info.reconnect_attempts < self.config.max_reconnect_attempts:
            await self._schedule_reconnection()
    
    async def _handle_connection_error(self, error: Exception) -> None:
        """Handle connection error during initial connection"""
        self.connection_info.state = ConnectionState.ERROR
        self.stats.error_count += 1
        self._emit_event('error', error)
        
        if self.connection_info.reconnect_attempts < self.config.max_reconnect_attempts:
            await self._schedule_reconnection()
    
    async def _schedule_reconnection(self) -> None:
        """Schedule reconnection attempt"""
        if self.reconnect_task and not self.reconnect_task.done():
            return  # Already scheduled
            
        self.connection_info.state = ConnectionState.RECONNECTING
        self.connection_info.reconnect_attempts += 1
        self.stats.reconnection_count += 1
        
        delay = min(
            self.config.reconnect_interval * (2 ** (self.connection_info.reconnect_attempts - 1)),
            60.0  # Max 1 minute delay
        ) / 1000.0  # Convert to seconds
        
        self._emit_event('reconnecting', {
            'attempt': self.connection_info.reconnect_attempts,
            'max_attempts': self.config.max_reconnect_attempts,
            'delay': delay
        })
        
        self.reconnect_task = asyncio.create_task(self._reconnect_after_delay(delay))
    
    async def _reconnect_after_delay(self, delay: float) -> None:
        """Reconnect after delay"""
        await asyncio.sleep(delay)
        
        try:
            await self.connect()
        except Exception as error:
            logger.error(f"Reconnection attempt failed: {error}")
            # Error handling will trigger another reconnection attempt
    
    async def _authenticate(self) -> None:
        """Authenticate with server"""
        if not self.request_signer or not self.config.auth:
            raise ValueError("Authentication credentials not available")
            
        timestamp = str(int(time.time() * 1000))
        auth_message = {
            'type': 'authenticate',
            'timestamp': timestamp,
            'api_key': self.config.auth.api_key
        }
        
        # Sign the authentication message
        signed_request = await self.request_signer.sign_request(
            method='POST',
            path='/ws/auth',
            body=json.dumps(auth_message),
            timestamp=timestamp
        )
        
        authenticated_message = {
            **auth_message,
            'signature': signed_request.signature
        }
        
        await self.send(authenticated_message)
    
    async def _handle_auth_response(self, message: Dict[str, Any]) -> None:
        """Handle authentication response"""
        if message.get('data', {}).get('success'):
            self.connection_info.authenticated = True
            self._emit_event('authenticated')
        else:
            self.connection_info.authenticated = False
            self._emit_event('authentication_failed', message.get('data'))
    
    async def _resubscribe_channels(self) -> None:
        """Re-subscribe to all channels after reconnection"""
        if not self.connection_info.subscriptions:
            return
            
        channels = list(self.connection_info.subscriptions)
        await self._send_subscription_request('subscribe', channels)
    
    async def _send_subscription_request(self, 
                                       request_type: str, 
                                       channels: List[str], 
                                       trading_pairs: Optional[List[str]] = None,
                                       auth: bool = False) -> None:
        """Send subscription request"""
        request = {
            'type': request_type,
            'channels': channels,
        }
        
        if trading_pairs:
            request['trading_pairs'] = trading_pairs
        if auth:
            request['auth'] = auth
            
        await self.send(request)
    
    def _handle_subscription_confirmation(self, message: Dict[str, Any]) -> None:
        """Handle subscription confirmation"""
        channel = message.get('data', {}).get('channel')
        if channel:
            self.pending_subscriptions.discard(channel)
            self._emit_event('subscribed', {'channel': channel})
    
    async def _route_message(self, message: Dict[str, Any]) -> None:
        """Route incoming message to appropriate handlers"""
        channel = message.get('channel')
        if not channel:
            return
            
        handlers = self.message_handlers.get(channel, [])
        for handler in handlers:
            try:
                await self._safe_call_handler(handler.handler, message.get('data'), {
                    'channel': channel,
                    'timestamp': message.get('timestamp'),
                    'sequence': message.get('sequence')
                })
            except Exception as error:
                self._emit_event('handler_error', {'error': error, 'message': message})
    
    async def _safe_call_handler(self, handler: Callable, data: Any, metadata: Dict[str, Any]) -> None:
        """Safely call message handler"""
        try:
            if asyncio.iscoroutinefunction(handler):
                await handler(data, metadata)
            else:
                handler(data, metadata)
        except Exception as error:
            logger.error(f"Handler error: {error}")
            raise
    
    async def _start_background_tasks(self) -> None:
        """Start background tasks for ping/pong and message handling"""
        # Start ping task
        self.ping_task = asyncio.create_task(self._ping_loop())
        
        # Start message handling task
        asyncio.create_task(self._message_loop())
    
    async def _ping_loop(self) -> None:
        """Background task for ping/pong heartbeat"""
        while self.connection_info.state == ConnectionState.CONNECTED and self.websocket:
            try:
                self.last_ping_time = time.time()
                
                # Send ping message
                ping_message = {
                    'type': 'ping',
                    'timestamp': int(time.time() * 1000)
                }
                await self.send(ping_message)
                
                # Wait for ping interval
                await asyncio.sleep(self.config.ping_interval / 1000.0)
                
            except Exception as error:
                logger.error(f"Ping error: {error}")
                break
    
    async def _message_loop(self) -> None:
        """Background task for handling incoming messages"""
        try:
            async for message in self.websocket:
                await self._handle_message(message)
        except ConnectionClosed as e:
            await self._handle_close(e.code, e.reason)
        except Exception as e:
            await self._handle_connection_error(e)
    
    def _handle_pong(self) -> None:
        """Handle pong response"""
        if self.last_ping_time > 0:
            latency = time.time() - self.last_ping_time
            self.latency_measurements.append(latency)
            
            # Keep only last 100 measurements
            if len(self.latency_measurements) > 100:
                self.latency_measurements.pop(0)
    
    def _calculate_average_latency(self) -> float:
        """Calculate average latency"""
        if not self.latency_measurements:
            return 0.0
        return sum(self.latency_measurements) / len(self.latency_measurements)
    
    async def _flush_message_queue(self) -> None:
        """Flush queued messages"""
        while self.message_queue:
            message = self.message_queue.pop(0)
            await self.send(message)
    
    async def _cleanup_tasks(self) -> None:
        """Clean up background tasks"""
        if self.reconnect_task and not self.reconnect_task.done():
            self.reconnect_task.cancel()
            try:
                await self.reconnect_task
            except asyncio.CancelledError:
                pass
                
        if self.ping_task and not self.ping_task.done():
            self.ping_task.cancel()
            try:
                await self.ping_task
            except asyncio.CancelledError:
                pass
    
    def _emit_event(self, event: str, data: Any = None) -> None:
        """Emit event to registered handlers"""
        handlers = self.event_handlers.get(event, [])
        for handler in handlers:
            try:
                if data is not None:
                    handler(data)
                else:
                    handler()
            except Exception as error:
                logger.error(f"Event handler error for {event}: {error}")
    
    async def shutdown(self) -> None:
        """Graceful shutdown"""
        await self._cleanup_tasks()
        
        # Unsubscribe from all channels
        if self.connection_info.subscriptions:
            channels = list(self.connection_info.subscriptions)
            await self.unsubscribe(channels)
        
        # Close connection
        await self.disconnect()
        
        # Clear handlers
        self.message_handlers.clear()
        for event_list in self.event_handlers.values():
            event_list.clear()

class SwappiQWebSocket(WebSocketClient):
    """Convenience wrapper for SwappiQ-specific WebSocket operations"""
    
    async def subscribe_to_order_book(self, trading_pairs: List[str]) -> None:
        """Subscribe to order book updates"""
        await self.subscribe(['orderbook'], trading_pairs=trading_pairs)
    
    async def subscribe_to_trades(self, trading_pairs: List[str]) -> None:
        """Subscribe to trade updates"""
        await self.subscribe(['trades'], trading_pairs=trading_pairs)
    
    async def subscribe_to_user_events(self) -> None:
        """Subscribe to user events (requires authentication)"""
        await self.subscribe(['orders', 'trades', 'balances'], auth=True)
    
    def on_order_book_update(self, handler: Callable[[OrderBookUpdate], None]) -> None:
        """Handle order book updates with typed data"""
        self.on_message('orderbook', handler)
    
    def on_trade_update(self, handler: Callable[[Trade], None]) -> None:
        """Handle trade updates with typed data"""
        self.on_message('trades', handler)
    
    def on_user_event(self, handler: Callable[[UserEvent], None]) -> None:
        """Handle user events with typed data"""
        self.on_message('orders', handler)
        self.on_message('trades', handler)
        self.on_message('balances', handler)