// Package swappiq provides WebSocket client with automatic reconnection
// Author: SwappiQ Protocol
// Description: Production-grade WebSocket client for real-time market data and events

package swappiq

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ConnectionState represents WebSocket connection states
type ConnectionState string

const (
	StateDisconnected ConnectionState = "disconnected"
	StateConnecting   ConnectionState = "connecting"
	StateConnected    ConnectionState = "connected"
	StateReconnecting ConnectionState = "reconnecting"
	StateClosed       ConnectionState = "closed"
)

// EventType represents types of events emitted by the WebSocket client
type EventType string

const (
	EventOpen           EventType = "open"
	EventClose          EventType = "close"
	EventError          EventType = "error"
	EventMessage        EventType = "message"
	EventReconnecting   EventType = "reconnecting"
	EventReconnected    EventType = "reconnected"
	EventPing           EventType = "ping"
	EventPong           EventType = "pong"
	EventSubscribed     EventType = "subscribed"
	EventUnsubscribed   EventType = "unsubscribed"
	EventOrderUpdate    EventType = "order_update"
	EventTradeUpdate    EventType = "trade_update"
	EventBalanceUpdate  EventType = "balance_update"
	EventOrderBookUpdate EventType = "orderbook_update"
	EventTickerUpdate   EventType = "ticker_update"
)

// WebSocketEvent represents an event emitted by the WebSocket client
type WebSocketEvent struct {
	Type      EventType   `json:"type"`
	Data      interface{} `json:"data,omitempty"`
	Error     error       `json:"error,omitempty"`
	Timestamp time.Time   `json:"timestamp"`
}

// EventHandler represents an event handler function
type EventHandler func(event WebSocketEvent)

// WebSocketClient provides enterprise-grade WebSocket functionality
type WebSocketClient struct {
	config        WebSocketConfig
	conn          *websocket.Conn
	state         ConnectionState
	stateMutex    sync.RWMutex
	
	// Event handling
	eventHandlers map[EventType][]EventHandler
	handlerMutex  sync.RWMutex
	
	// Subscriptions
	subscriptions map[string]SubscriptionRequest
	subMutex      sync.RWMutex
	
	// Reconnection
	reconnectAttempts int
	maxReconnectAttempts int
	reconnectInterval time.Duration
	backoffFactor     float64
	
	// Ping/Pong
	pingInterval time.Duration
	lastPong     time.Time
	pongTimeout  time.Duration
	
	// Control channels
	ctx        context.Context
	cancel     context.CancelFunc
	writeChan  chan []byte
	done       chan struct{}
	wg         sync.WaitGroup
	
	// Authentication
	auth           *AuthCredentials
	requestSigner  *RequestSigner
	authenticated  bool
	
	// Statistics
	messagesSent     int64
	messagesReceived int64
	bytesReceived    int64
	reconnectCount   int64
	lastError        error
	connectedAt      time.Time
	
	debug bool
}

// NewWebSocketClient creates a new WebSocket client instance
func NewWebSocketClient(config WebSocketConfig) *WebSocketClient {
	ctx, cancel := context.WithCancel(context.Background())
	
	client := &WebSocketClient{
		config:               config,
		state:                StateDisconnected,
		eventHandlers:        make(map[EventType][]EventHandler),
		subscriptions:        make(map[string]SubscriptionRequest),
		maxReconnectAttempts: config.MaxReconnectAttempts,
		reconnectInterval:    time.Duration(config.ReconnectInterval) * time.Millisecond,
		backoffFactor:        1.5,
		pingInterval:         time.Duration(config.PingInterval) * time.Millisecond,
		pongTimeout:          30 * time.Second,
		ctx:                  ctx,
		cancel:               cancel,
		writeChan:            make(chan []byte, 256),
		done:                 make(chan struct{}),
		auth:                 config.Auth,
		debug:                true, // Can be configured
	}
	
	if client.auth != nil {
		client.requestSigner = NewRequestSigner(*client.auth)
	}
	
	return client
}

// Connect establishes WebSocket connection
func (ws *WebSocketClient) Connect() error {
	ws.stateMutex.Lock()
	if ws.state == StateConnected || ws.state == StateConnecting {
		ws.stateMutex.Unlock()
		return fmt.Errorf("already connected or connecting")
	}
	ws.setState(StateConnecting)
	ws.stateMutex.Unlock()
	
	if err := ws.dial(); err != nil {
		ws.setState(StateDisconnected)
		return err
	}
	
	ws.setState(StateConnected)
	ws.connectedAt = time.Now()
	ws.lastPong = time.Now()
	ws.reconnectAttempts = 0
	
	// Start background routines
	ws.wg.Add(3)
	go ws.readLoop()
	go ws.writeLoop()
	go ws.pingLoop()
	
	ws.emitEvent(EventOpen, nil, nil)
	
	// Re-subscribe to channels after connection
	if err := ws.resubscribe(); err != nil {
		if ws.debug {
			log.Printf("Failed to resubscribe: %v", err)
		}
	}
	
	return nil
}

// dial establishes the WebSocket connection
func (ws *WebSocketClient) dial() error {
	u, err := url.Parse(ws.config.URL)
	if err != nil {
		return fmt.Errorf("invalid WebSocket URL: %w", err)
	}
	
	headers := make(map[string][]string)
	headers["User-Agent"] = []string{"SwappiQ-SDK-Go/1.0.0"}
	
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}
	
	conn, _, err := dialer.Dial(u.String(), headers)
	if err != nil {
		return fmt.Errorf("WebSocket dial failed: %w", err)
	}
	
	ws.conn = conn
	return nil
}

// readLoop handles incoming messages
func (ws *WebSocketClient) readLoop() {
	defer ws.wg.Done()
	defer ws.conn.Close()
	
	for {
		select {
		case <-ws.ctx.Done():
			return
		default:
		}
		
		messageType, data, err := ws.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				ws.lastError = err
				ws.emitEvent(EventError, nil, err)
			}
			ws.handleDisconnection()
			return
		}
		
		ws.messagesReceived++
		ws.bytesReceived += int64(len(data))
		
		switch messageType {
		case websocket.TextMessage:
			ws.handleTextMessage(data)
		case websocket.BinaryMessage:
			ws.handleBinaryMessage(data)
		case websocket.PongMessage:
			ws.handlePongMessage()
		}
	}
}

// writeLoop handles outgoing messages
func (ws *WebSocketClient) writeLoop() {
	defer ws.wg.Done()
	
	for {
		select {
		case <-ws.ctx.Done():
			return
		case data := <-ws.writeChan:
			if err := ws.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				ws.lastError = err
				ws.emitEvent(EventError, nil, err)
				return
			}
			ws.messagesSent++
		}
	}
}

// pingLoop sends periodic ping messages
func (ws *WebSocketClient) pingLoop() {
	defer ws.wg.Done()
	
	ticker := time.NewTicker(ws.pingInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ws.ctx.Done():
			return
		case <-ticker.C:
			if time.Since(ws.lastPong) > ws.pongTimeout {
				ws.lastError = fmt.Errorf("pong timeout")
				ws.emitEvent(EventError, nil, ws.lastError)
				ws.handleDisconnection()
				return
			}
			
			if err := ws.conn.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
				ws.lastError = err
				ws.emitEvent(EventError, nil, err)
				return
			}
			
			ws.emitEvent(EventPing, nil, nil)
		}
	}
}

// handleTextMessage processes incoming text messages
func (ws *WebSocketClient) handleTextMessage(data []byte) {
	var message WebSocketMessage
	if err := json.Unmarshal(data, &message); err != nil {
		ws.emitEvent(EventError, nil, fmt.Errorf("failed to parse message: %w", err))
		return
	}
	
	ws.emitEvent(EventMessage, message, nil)
	
	// Handle specific message types
	switch message.Type {
	case "orderbook_update":
		ws.emitEvent(EventOrderBookUpdate, message.Data, nil)
	case "trade_update":
		ws.emitEvent(EventTradeUpdate, message.Data, nil)
	case "ticker_update":
		ws.emitEvent(EventTickerUpdate, message.Data, nil)
	case "order_update":
		ws.emitEvent(EventOrderUpdate, message.Data, nil)
	case "balance_update":
		ws.emitEvent(EventBalanceUpdate, message.Data, nil)
	case "subscribed":
		ws.emitEvent(EventSubscribed, message.Data, nil)
	case "unsubscribed":
		ws.emitEvent(EventUnsubscribed, message.Data, nil)
	}
}

// handleBinaryMessage processes incoming binary messages
func (ws *WebSocketClient) handleBinaryMessage(data []byte) {
	// Handle binary messages if needed
	ws.emitEvent(EventMessage, data, nil)
}

// handlePongMessage processes pong responses
func (ws *WebSocketClient) handlePongMessage() {
	ws.lastPong = time.Now()
	ws.emitEvent(EventPong, nil, nil)
}

// handleDisconnection handles connection loss and triggers reconnection
func (ws *WebSocketClient) handleDisconnection() {
	ws.setState(StateDisconnected)
	ws.emitEvent(EventClose, nil, nil)
	
	if ws.reconnectAttempts < ws.maxReconnectAttempts {
		ws.reconnect()
	} else {
		ws.setState(StateClosed)
		if ws.debug {
			log.Printf("Max reconnection attempts reached, giving up")
		}
	}
}

// reconnect attempts to reconnect to the WebSocket
func (ws *WebSocketClient) reconnect() {
	ws.setState(StateReconnecting)
	ws.reconnectAttempts++
	ws.reconnectCount++
	
	delay := ws.calculateReconnectDelay()
	ws.emitEvent(EventReconnecting, map[string]interface{}{
		"attempt": ws.reconnectAttempts,
		"delay":   delay,
	}, nil)
	
	if ws.debug {
		log.Printf("Reconnecting in %v (attempt %d/%d)", delay, ws.reconnectAttempts, ws.maxReconnectAttempts)
	}
	
	time.Sleep(delay)
	
	if err := ws.Connect(); err != nil {
		ws.lastError = err
		ws.emitEvent(EventError, nil, err)
		if ws.reconnectAttempts < ws.maxReconnectAttempts {
			ws.reconnect()
		}
	} else {
		ws.emitEvent(EventReconnected, nil, nil)
	}
}

// calculateReconnectDelay calculates exponential backoff delay
func (ws *WebSocketClient) calculateReconnectDelay() time.Duration {
	delay := float64(ws.reconnectInterval) * math.Pow(ws.backoffFactor, float64(ws.reconnectAttempts-1))
	maxDelay := float64(60 * time.Second)
	
	if delay > maxDelay {
		delay = maxDelay
	}
	
	// Add jitter ±25%
	jitter := delay * 0.25
	randomBytes := make([]byte, 1)
	rand.Read(randomBytes)
	jitterAmount := (float64(randomBytes[0])/255.0 - 0.5) * 2 * jitter
	
	return time.Duration(delay + jitterAmount)
}

// Subscribe subscribes to channels
func (ws *WebSocketClient) Subscribe(request SubscriptionRequest) error {
	// Store subscription for reconnection
	subscriptionID := ws.generateSubscriptionID(request)
	ws.subMutex.Lock()
	ws.subscriptions[subscriptionID] = request
	ws.subMutex.Unlock()
	
	return ws.sendSubscriptionRequest(request)
}

// Unsubscribe unsubscribes from channels
func (ws *WebSocketClient) Unsubscribe(channels []string, tradingPairs []string) error {
	request := SubscriptionRequest{
		Type:         "unsubscribe",
		Channels:     channels,
		TradingPairs: tradingPairs,
	}
	
	// Remove from stored subscriptions
	subscriptionID := ws.generateSubscriptionID(request)
	ws.subMutex.Lock()
	delete(ws.subscriptions, subscriptionID)
	ws.subMutex.Unlock()
	
	return ws.sendSubscriptionRequest(request)
}

// sendSubscriptionRequest sends a subscription request
func (ws *WebSocketClient) sendSubscriptionRequest(request SubscriptionRequest) error {
	data, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("marshal subscription request: %w", err)
	}
	
	return ws.Send(data)
}

// resubscribe re-subscribes to all stored subscriptions
func (ws *WebSocketClient) resubscribe() error {
	ws.subMutex.RLock()
	subscriptions := make(map[string]SubscriptionRequest)
	for k, v := range ws.subscriptions {
		subscriptions[k] = v
	}
	ws.subMutex.RUnlock()
	
	for _, subscription := range subscriptions {
		if err := ws.sendSubscriptionRequest(subscription); err != nil {
			return err
		}
	}
	
	return nil
}

// generateSubscriptionID generates a unique ID for a subscription
func (ws *WebSocketClient) generateSubscriptionID(request SubscriptionRequest) string {
	data, _ := json.Marshal(request)
	randomBytes := make([]byte, 4)
	rand.Read(randomBytes)
	return fmt.Sprintf("%x_%x", data, randomBytes)
}

// Send sends a message through the WebSocket
func (ws *WebSocketClient) Send(data []byte) error {
	if ws.getState() != StateConnected {
		return fmt.Errorf("WebSocket not connected")
	}
	
	select {
	case ws.writeChan <- data:
		return nil
	case <-ws.ctx.Done():
		return fmt.Errorf("WebSocket client closed")
	case <-time.After(5 * time.Second):
		return fmt.Errorf("send timeout")
	}
}

// SendJSON sends a JSON message through the WebSocket
func (ws *WebSocketClient) SendJSON(data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal JSON: %w", err)
	}
	
	return ws.Send(jsonData)
}

// Close gracefully closes the WebSocket connection
func (ws *WebSocketClient) Close() error {
	ws.setState(StateClosed)
	
	// Cancel context to stop all goroutines
	ws.cancel()
	
	// Close WebSocket connection
	if ws.conn != nil {
		ws.conn.Close()
	}
	
	// Wait for goroutines to finish
	ws.wg.Wait()
	
	close(ws.done)
	return nil
}

// Event handling methods

// On registers an event handler
func (ws *WebSocketClient) On(eventType EventType, handler EventHandler) {
	ws.handlerMutex.Lock()
	defer ws.handlerMutex.Unlock()
	
	ws.eventHandlers[eventType] = append(ws.eventHandlers[eventType], handler)
}

// Off removes event handlers
func (ws *WebSocketClient) Off(eventType EventType) {
	ws.handlerMutex.Lock()
	defer ws.handlerMutex.Unlock()
	
	delete(ws.eventHandlers, eventType)
}

// emitEvent emits an event to all registered handlers
func (ws *WebSocketClient) emitEvent(eventType EventType, data interface{}, err error) {
	event := WebSocketEvent{
		Type:      eventType,
		Data:      data,
		Error:     err,
		Timestamp: time.Now(),
	}
	
	ws.handlerMutex.RLock()
	handlers := ws.eventHandlers[eventType]
	ws.handlerMutex.RUnlock()
	
	for _, handler := range handlers {
		go handler(event) // Handle events concurrently
	}
}

// State management

// getState safely gets the current state
func (ws *WebSocketClient) getState() ConnectionState {
	ws.stateMutex.RLock()
	defer ws.stateMutex.RUnlock()
	return ws.state
}

// setState safely sets the current state
func (ws *WebSocketClient) setState(state ConnectionState) {
	ws.stateMutex.Lock()
	defer ws.stateMutex.Unlock()
	ws.state = state
}

// GetState returns the current connection state
func (ws *WebSocketClient) GetState() ConnectionState {
	return ws.getState()
}

// IsConnected returns true if WebSocket is connected
func (ws *WebSocketClient) IsConnected() bool {
	return ws.getState() == StateConnected
}

// GetStats returns WebSocket client statistics
func (ws *WebSocketClient) GetStats() map[string]interface{} {
	ws.stateMutex.RLock()
	defer ws.stateMutex.RUnlock()
	
	uptime := time.Duration(0)
	if !ws.connectedAt.IsZero() {
		uptime = time.Since(ws.connectedAt)
	}
	
	return map[string]interface{}{
		"state":               ws.state,
		"connected_at":        ws.connectedAt,
		"uptime":              uptime.Seconds(),
		"messages_sent":       ws.messagesSent,
		"messages_received":   ws.messagesReceived,
		"bytes_received":      ws.bytesReceived,
		"reconnect_attempts":  ws.reconnectAttempts,
		"reconnect_count":     ws.reconnectCount,
		"last_error":          ws.lastError,
		"subscriptions":       len(ws.subscriptions),
		"last_pong":           ws.lastPong,
	}
}