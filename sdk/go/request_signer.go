// Package swappiq provides request signing utilities for secure API authentication
// Author: SwappiQ Protocol
// Description: Production-grade request signing with multiple algorithms and security features

package swappiq

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// SigningAlgorithm represents supported signing algorithms
type SigningAlgorithm string

const (
	HMACSHA256 SigningAlgorithm = "HMAC-SHA256"
	HMACSHA512 SigningAlgorithm = "HMAC-SHA512"
)

// SigningOptions represents signing configuration
type SigningOptions struct {
	Algorithm          SigningAlgorithm `json:"algorithm"`
	IncludeBody        bool             `json:"include_body"`
	IncludeHeaders     []string         `json:"include_headers"`
	TimestampTolerance int64            `json:"timestamp_tolerance"` // milliseconds
	Nonce              bool             `json:"nonce"`
}

// DefaultSigningOptions returns default signing options
func DefaultSigningOptions() SigningOptions {
	return SigningOptions{
		Algorithm:          HMACSHA256,
		IncludeBody:        true,
		IncludeHeaders:     []string{"content-type", "x-timestamp"},
		TimestampTolerance: 30000, // 30 seconds
		Nonce:              true,
	}
}

// SignatureComponents represents components used to build signature
type SignatureComponents struct {
	Method    string `json:"method"`
	Path      string `json:"path"`
	Timestamp string `json:"timestamp"`
	Nonce     string `json:"nonce,omitempty"`
	Body      string `json:"body,omitempty"`
	Headers   string `json:"headers,omitempty"`
}

// RequestSigner provides enterprise-grade request signing functionality
type RequestSigner struct {
	credentials    *AuthCredentials
	defaultOptions SigningOptions
}

// NewRequestSigner creates a new request signer instance
func NewRequestSigner(credentials AuthCredentials) *RequestSigner {
	return &RequestSigner{
		credentials:    &credentials,
		defaultOptions: DefaultSigningOptions(),
	}
}

// SignRequest signs an HTTP request for API authentication
func (rs *RequestSigner) SignRequest(request SignedRequest) (*SignedRequest, error) {
	return rs.SignRequestWithOptions(request, rs.defaultOptions)
}

// SignRequestWithOptions signs a request with custom options
func (rs *RequestSigner) SignRequestWithOptions(request SignedRequest, options SigningOptions) (*SignedRequest, error) {
	if rs.credentials == nil {
		return nil, fmt.Errorf("authentication credentials not provided")
	}

	// Use provided timestamp or generate new one
	timestamp := request.Timestamp
	if timestamp == "" {
		timestamp = strconv.FormatInt(time.Now().UnixMilli(), 10)
	}

	// Generate nonce if required
	var nonce string
	if options.Nonce {
		var err error
		nonce, err = rs.generateNonce(16)
		if err != nil {
			return nil, fmt.Errorf("generate nonce: %w", err)
		}
	}

	// Build signature components
	components := rs.buildSignatureComponents(
		request.Method,
		request.Path,
		timestamp,
		nonce,
		request.Body,
		options,
	)

	// Generate signature
	signature, err := rs.generateSignature(components, options.Algorithm)
	if err != nil {
		return nil, fmt.Errorf("generate signature: %w", err)
	}

	// Build headers
	headers := rs.buildAuthHeaders(
		rs.credentials.APIKey,
		timestamp,
		nonce,
		signature,
		rs.credentials.Passphrase,
	)

	// Merge with existing headers
	if request.Headers != nil {
		for k, v := range request.Headers {
			headers[k] = v
		}
	}

	return &SignedRequest{
		Method:    request.Method,
		Path:      request.Path,
		Body:      request.Body,
		Timestamp: timestamp,
		Signature: signature,
		Headers:   headers,
	}, nil
}

// VerifyRequest verifies a signed request (for webhook validation)
func (rs *RequestSigner) VerifyRequest(request SignedRequest, secret string, options SigningOptions) (bool, error) {
	// Check timestamp tolerance
	if options.TimestampTolerance > 0 {
		requestTime, err := strconv.ParseInt(request.Timestamp, 10, 64)
		if err != nil {
			return false, fmt.Errorf("parse timestamp: %w", err)
		}

		currentTime := time.Now().UnixMilli()
		timeDiff := abs(currentTime - requestTime)

		if timeDiff > options.TimestampTolerance {
			return false, fmt.Errorf("request timestamp outside tolerance")
		}
	}

	// Extract nonce from headers
	nonce := rs.extractNonceFromHeaders(request.Headers)

	// Reconstruct signature components
	components := rs.buildSignatureComponents(
		request.Method,
		request.Path,
		request.Timestamp,
		nonce,
		request.Body,
		options,
	)

	// Generate expected signature
	expectedSignature, err := rs.generateSignatureWithSecret(components, secret, options.Algorithm)
	if err != nil {
		return false, fmt.Errorf("generate expected signature: %w", err)
	}

	// Timing-safe comparison
	return rs.compareSignatures(request.Signature, expectedSignature), nil
}

// generateSignature generates signature from components using credentials
func (rs *RequestSigner) generateSignature(components SignatureComponents, algorithm SigningAlgorithm) (string, error) {
	if rs.credentials == nil || rs.credentials.APISecret == "" {
		return "", fmt.Errorf("API secret not provided")
	}

	return rs.generateSignatureWithSecret(components, rs.credentials.APISecret, algorithm)
}

// generateSignatureWithSecret generates signature with provided secret
func (rs *RequestSigner) generateSignatureWithSecret(components SignatureComponents, secret string, algorithm SigningAlgorithm) (string, error) {
	message := rs.buildSignatureString(components)

	switch algorithm {
	case HMACSHA256:
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(message))
		return hex.EncodeToString(mac.Sum(nil)), nil

	case HMACSHA512:
		mac := hmac.New(sha512.New, []byte(secret))
		mac.Write([]byte(message))
		return hex.EncodeToString(mac.Sum(nil)), nil

	default:
		return "", fmt.Errorf("unsupported signing algorithm: %s", algorithm)
	}
}

// buildSignatureComponents builds signature components for message construction
func (rs *RequestSigner) buildSignatureComponents(method, path, timestamp, nonce, body string, options SigningOptions) SignatureComponents {
	components := SignatureComponents{
		Method:    strings.ToUpper(method),
		Path:      path,
		Timestamp: timestamp,
		Nonce:     nonce,
	}

	if options.IncludeBody && body != "" {
		components.Body = rs.normalizeBody(body)
	}

	return components
}

// buildSignatureString builds the string to be signed
func (rs *RequestSigner) buildSignatureString(components SignatureComponents) string {
	parts := []string{
		components.Method,
		components.Path,
		components.Timestamp,
	}

	if components.Nonce != "" {
		parts = append(parts, components.Nonce)
	}

	if components.Body != "" {
		parts = append(parts, components.Body)
	}

	if components.Headers != "" {
		parts = append(parts, components.Headers)
	}

	return strings.Join(parts, "\n")
}

// buildAuthHeaders builds authentication headers
func (rs *RequestSigner) buildAuthHeaders(apiKey, timestamp, nonce, signature string, passphrase *string) map[string]string {
	headers := map[string]string{
		"X-API-Key":   apiKey,
		"X-Timestamp": timestamp,
		"X-Signature": signature,
	}

	if nonce != "" {
		headers["X-Nonce"] = nonce
	}

	if passphrase != nil && *passphrase != "" {
		headers["X-Passphrase"] = *passphrase
	}

	return headers
}

// generateNonce generates cryptographically secure nonce
func (rs *RequestSigner) generateNonce(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// normalizeBody normalizes request body for consistent signing
func (rs *RequestSigner) normalizeBody(body string) string {
	if body == "" {
		return ""
	}

	// Try to parse and normalize JSON
	var parsed interface{}
	if err := json.Unmarshal([]byte(body), &parsed); err == nil {
		// Re-marshal with sorted keys for consistency
		normalized, err := json.Marshal(parsed)
		if err == nil {
			return string(normalized)
		}
	}

	// If not JSON, return as-is
	return body
}

// extractNonceFromHeaders extracts nonce from request headers
func (rs *RequestSigner) extractNonceFromHeaders(headers map[string]string) string {
	for key, value := range headers {
		if strings.ToLower(key) == "x-nonce" {
			return value
		}
	}
	return ""
}

// compareSignatures performs timing-safe signature comparison
func (rs *RequestSigner) compareSignatures(signature1, signature2 string) bool {
	return subtle.ConstantTimeCompare([]byte(signature1), []byte(signature2)) == 1
}

// CreateWebhookSignature creates signature for webhook payload
func (rs *RequestSigner) CreateWebhookSignature(payload, secret string, algorithm string) (string, error) {
	switch algorithm {
	case "sha256":
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(payload))
		return hex.EncodeToString(mac.Sum(nil)), nil

	case "sha512":
		mac := hmac.New(sha512.New, []byte(secret))
		mac.Write([]byte(payload))
		return hex.EncodeToString(mac.Sum(nil)), nil

	default:
		return "", fmt.Errorf("unsupported webhook algorithm: %s", algorithm)
	}
}

// VerifyWebhookSignature verifies webhook signature
func (rs *RequestSigner) VerifyWebhookSignature(payload, signature, secret, algorithm string) (bool, error) {
	expectedSignature, err := rs.CreateWebhookSignature(payload, secret, algorithm)
	if err != nil {
		return false, err
	}

	return rs.compareSignatures(signature, expectedSignature), nil
}

// Static utility functions

// GenerateAPIKeyPair generates API key pair for development/testing
func GenerateAPIKeyPair() (map[string]string, error) {
	keyBytes := make([]byte, 16)
	secretBytes := make([]byte, 32)

	if _, err := rand.Read(keyBytes); err != nil {
		return nil, err
	}
	if _, err := rand.Read(secretBytes); err != nil {
		return nil, err
	}

	return map[string]string{
		"api_key":    "sk_" + hex.EncodeToString(keyBytes),
		"api_secret": hex.EncodeToString(secretBytes),
	}, nil
}

// HashForLogging hashes sensitive data for logging
func HashForLogging(data string) string {
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:4]) // First 8 characters
}

// ValidateAPIKey validates API key format
func ValidateAPIKey(apiKey string) bool {
	matched, _ := regexp.MatchString(`^sk_[a-f0-9]{32}$`, apiKey)
	return matched
}

// ValidateAPISecret validates API secret format
func ValidateAPISecret(apiSecret string) bool {
	matched, _ := regexp.MatchString(`^[a-f0-9]{64}$`, apiSecret)
	return matched
}

// Utility functions

// abs returns absolute value of int64
func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

// sortHeaders sorts headers for consistent signing
func sortHeaders(headers map[string]string, includeHeaders []string) string {
	if len(includeHeaders) == 0 {
		return ""
	}

	var parts []string
	sort.Strings(includeHeaders)

	for _, header := range includeHeaders {
		if value, exists := headers[strings.ToLower(header)]; exists {
			parts = append(parts, fmt.Sprintf("%s:%s", strings.ToLower(header), value))
		}
	}

	return strings.Join(parts, "\n")
}

// CreateRequestSigner creates a configured request signer
func CreateRequestSigner(credentials AuthCredentials, options *SigningOptions) *RequestSigner {
	signer := NewRequestSigner(credentials)
	if options != nil {
		signer.defaultOptions = *options
	}
	return signer
}

// SignRequest utility function for quick request signing
func SignRequest(method, path, body string, credentials AuthCredentials, options *SigningOptions) (*SignedRequest, error) {
	signer := NewRequestSigner(credentials)
	
	request := SignedRequest{
		Method: method,
		Path:   path,
		Body:   body,
	}

	if options != nil {
		return signer.SignRequestWithOptions(request, *options)
	}
	
	return signer.SignRequest(request)
}

// VerifyWebhookSignature utility function for webhook signature verification
func VerifyWebhookSignature(payload, signature, secret, algorithm string) (bool, error) {
	signer := &RequestSigner{}
	return signer.VerifyWebhookSignature(payload, signature, secret, algorithm)
}