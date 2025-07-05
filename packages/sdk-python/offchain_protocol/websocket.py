"""
WebSocket client for real-time data streaming
"""
import asyncio
import json
import logging
from typing import Optional, List, Dict, Any, AsyncIterator
from datetime import datetime

import websockets
from websockets.client import WebSocketClientProtocol
from websockets.exceptions import ConnectionClosed, WebSocketException

from .exceptions import WebSocketError, AuthenticationError

logger = logging.getLogger(__name__)


class WebSocketClient:
    """
    WebSocket client for streaming real-time data
    
    Example:
        >>> ws = WebSocketClient('wss://ws.offchain.finance', 'your-api-key')
        >>> await ws.connect()
        >>> 
        >>> await ws.subscribe_trades(['BTC/USDT', 'ETH/USDT'])
        >>> async for trade in ws.stream_trades('BTC/USDT'):
        ...     print(f"Trade: {trade['price']} @ {trade['quantity']}")
    """
    
    def __init__(
        self,
        url: str,
        api_key: str,
        reconnect: bool = True,
        reconnect_interval: int = 5,
        heartbeat_interval: int = 30
    ):
        self.url = url
        self.api_key = api_key
        self.reconnect = reconnect
        self.reconnect_interval = reconnect_interval
        self.heartbeat_interval = heartbeat_interval
        
        self._ws: Optional[WebSocketClientProtocol] = None
        self._subscriptions: Dict[str, List[str]] = {}
        self._authenticated = False
        self._running = False
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._message_queue: asyncio.Queue = asyncio.Queue()
    
    async def connect(self):
        """Connect to WebSocket server"""
        try:
            self._ws = await websockets.connect(
                self.url,
                extra_headers={"X-API-KEY": self.api_key}
            )
            self._running = True
            
            # Start heartbeat
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            
            # Start message handler
            asyncio.create_task(self._message_handler())
            
            # Wait for authentication
            auth_msg = await self._wait_for_message("auth")
            if auth_msg.get("status") != "success":
                raise AuthenticationError("WebSocket authentication failed")
            
            self._authenticated = True
            logger.info("WebSocket connected and authenticated")
            
            # Resubscribe to previous subscriptions
            await self._resubscribe()
            
        except Exception as e:
            await self.close()
            raise WebSocketError(f"Failed to connect: {str(e)}")
    
    async def close(self):
        """Close WebSocket connection"""
        self._running = False
        
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        
        if self._ws:
            await self._ws.close()
            self._ws = None
        
        self._authenticated = False
        logger.info("WebSocket connection closed")
    
    async def _heartbeat_loop(self):
        """Send periodic heartbeat messages"""
        while self._running:
            try:
                if self._ws and not self._ws.closed:
                    await self._ws.send(json.dumps({"type": "ping"}))
                await asyncio.sleep(self.heartbeat_interval)
            except Exception as e:
                logger.error(f"Heartbeat error: {e}")
                if self.reconnect:
                    await self._reconnect()
                break
    
    async def _message_handler(self):
        """Handle incoming messages"""
        while self._running:
            try:
                if not self._ws or self._ws.closed:
                    await asyncio.sleep(0.1)
                    continue
                
                message = await self._ws.recv()
                data = json.loads(message)
                
                # Put message in queue for streaming
                await self._message_queue.put(data)
                
            except ConnectionClosed:
                logger.warning("WebSocket connection closed")
                if self.reconnect:
                    await self._reconnect()
                else:
                    self._running = False
            except Exception as e:
                logger.error(f"Message handler error: {e}")
    
    async def _reconnect(self):
        """Reconnect to WebSocket server"""
        if not self.reconnect:
            return
        
        logger.info(f"Reconnecting in {self.reconnect_interval} seconds...")
        await asyncio.sleep(self.reconnect_interval)
        
        try:
            await self.connect()
        except Exception as e:
            logger.error(f"Reconnection failed: {e}")
            # Exponential backoff could be implemented here
    
    async def _resubscribe(self):
        """Resubscribe to previous subscriptions after reconnection"""
        for channel, pairs in self._subscriptions.items():
            if channel == "orders":
                await self.subscribe_orders()
            elif channel == "trades":
                await self.subscribe_trades(pairs)
            elif channel == "orderbook":
                await self.subscribe_orderbook(pairs)
            elif channel == "ticker":
                await self.subscribe_ticker(pairs)
    
    async def _send(self, message: Dict[str, Any]):
        """Send message to WebSocket server"""
        if not self._ws or self._ws.closed:
            raise WebSocketError("WebSocket is not connected")
        
        await self._ws.send(json.dumps(message))
    
    async def _wait_for_message(self, event_type: str, timeout: float = 5.0) -> Dict[str, Any]:
        """Wait for a specific message type"""
        start_time = asyncio.get_event_loop().time()
        
        while asyncio.get_event_loop().time() - start_time < timeout:
            try:
                message = await asyncio.wait_for(
                    self._message_queue.get(),
                    timeout=0.1
                )
                
                if message.get("type") == event_type or message.get("event") == event_type:
                    return message
                else:
                    # Put it back if not the message we're waiting for
                    await self._message_queue.put(message)
                    
            except asyncio.TimeoutError:
                continue
        
        raise WebSocketError(f"Timeout waiting for {event_type} message")
    
    # Subscription methods
    
    async def subscribe_orders(self):
        """Subscribe to order updates"""
        await self._send({"type": "subscribe", "channel": "orders"})
        self._subscriptions["orders"] = []
        logger.info("Subscribed to order updates")
    
    async def unsubscribe_orders(self):
        """Unsubscribe from order updates"""
        await self._send({"type": "unsubscribe", "channel": "orders"})
        self._subscriptions.pop("orders", None)
        logger.info("Unsubscribed from order updates")
    
    async def subscribe_trades(self, pairs: List[str]):
        """Subscribe to trade updates for specific pairs"""
        await self._send({
            "type": "subscribe",
            "channel": "trades",
            "pairs": pairs
        })
        self._subscriptions["trades"] = pairs
        logger.info(f"Subscribed to trades for {pairs}")
    
    async def unsubscribe_trades(self, pairs: List[str]):
        """Unsubscribe from trade updates"""
        await self._send({
            "type": "unsubscribe",
            "channel": "trades",
            "pairs": pairs
        })
        current_pairs = self._subscriptions.get("trades", [])
        self._subscriptions["trades"] = [p for p in current_pairs if p not in pairs]
        logger.info(f"Unsubscribed from trades for {pairs}")
    
    async def subscribe_orderbook(self, pairs: List[str]):
        """Subscribe to order book updates"""
        await self._send({
            "type": "subscribe",
            "channel": "orderbook",
            "pairs": pairs
        })
        self._subscriptions["orderbook"] = pairs
        logger.info(f"Subscribed to orderbook for {pairs}")
    
    async def unsubscribe_orderbook(self, pairs: List[str]):
        """Unsubscribe from order book updates"""
        await self._send({
            "type": "unsubscribe",
            "channel": "orderbook",
            "pairs": pairs
        })
        current_pairs = self._subscriptions.get("orderbook", [])
        self._subscriptions["orderbook"] = [p for p in current_pairs if p not in pairs]
        logger.info(f"Unsubscribed from orderbook for {pairs}")
    
    async def subscribe_ticker(self, pairs: List[str]):
        """Subscribe to ticker updates"""
        await self._send({
            "type": "subscribe",
            "channel": "ticker",
            "pairs": pairs
        })
        self._subscriptions["ticker"] = pairs
        logger.info(f"Subscribed to ticker for {pairs}")
    
    async def unsubscribe_ticker(self, pairs: List[str]):
        """Unsubscribe from ticker updates"""
        await self._send({
            "type": "unsubscribe",
            "channel": "ticker",
            "pairs": pairs
        })
        current_pairs = self._subscriptions.get("ticker", [])
        self._subscriptions["ticker"] = [p for p in current_pairs if p not in pairs]
        logger.info(f"Unsubscribed from ticker for {pairs}")
    
    # Streaming methods
    
    async def stream_orders(self) -> AsyncIterator[Dict[str, Any]]:
        """Stream order updates"""
        while self._running:
            try:
                message = await asyncio.wait_for(
                    self._message_queue.get(),
                    timeout=1.0
                )
                
                if message.get("channel") == "orders" or message.get("type") in [
                    "order:submitted", "order:filled", "order:cancelled", "order:update"
                ]:
                    yield message.get("data", message)
                else:
                    # Put back if not an order message
                    await self._message_queue.put(message)
                    
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Error streaming orders: {e}")
    
    async def stream_trades(self, pair: str) -> AsyncIterator[Dict[str, Any]]:
        """Stream trades for a specific pair"""
        while self._running:
            try:
                message = await asyncio.wait_for(
                    self._message_queue.get(),
                    timeout=1.0
                )
                
                if (message.get("channel") == "trades" and 
                    message.get("data", {}).get("pair") == pair):
                    yield message["data"]
                else:
                    # Put back if not for this pair
                    await self._message_queue.put(message)
                    
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Error streaming trades: {e}")
    
    async def stream_orderbook(self, pair: str) -> AsyncIterator[Dict[str, Any]]:
        """Stream order book updates for a specific pair"""
        while self._running:
            try:
                message = await asyncio.wait_for(
                    self._message_queue.get(),
                    timeout=1.0
                )
                
                if (message.get("channel") == "orderbook" and 
                    message.get("data", {}).get("pair") == pair):
                    yield message["data"]
                else:
                    # Put back if not for this pair
                    await self._message_queue.put(message)
                    
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Error streaming orderbook: {e}")
    
    async def stream_ticker(self, pair: str) -> AsyncIterator[Dict[str, Any]]:
        """Stream ticker updates for a specific pair"""
        while self._running:
            try:
                message = await asyncio.wait_for(
                    self._message_queue.get(),
                    timeout=1.0
                )
                
                if (message.get("channel") == "ticker" and 
                    message.get("data", {}).get("pair") == pair):
                    yield message["data"]
                else:
                    # Put back if not for this pair
                    await self._message_queue.put(message)
                    
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Error streaming ticker: {e}")
    
    @property
    def is_connected(self) -> bool:
        """Check if WebSocket is connected"""
        return self._ws is not None and not self._ws.closed
    
    @property
    def is_authenticated(self) -> bool:
        """Check if WebSocket is authenticated"""
        return self._authenticated