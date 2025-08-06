"""
Request signing utilities for secure API authentication
Author: SwappiQ Protocol
Description: Production-grade request signing with multiple algorithms and security features
"""

import hmac
import hashlib
import time
import json
import secrets
from typing import Dict, List, Optional, Literal
from dataclasses import dataclass
import base64

from .types import AuthCredentials, SignedRequest

@dataclass
class SigningOptions:
    algorithm: Literal['HMAC-SHA256', 'HMAC-SHA512'] = 'HMAC-SHA256'
    include_body: bool = True
    include_headers: List[str] = None
    timestamp_tolerance: int = 30000  # 30 seconds
    nonce: bool = True

@dataclass
class SignatureComponents:
    method: str
    path: str
    timestamp: str
    nonce: Optional[str] = None
    body: Optional[str] = None
    headers: Optional[str] = None

class RequestSigner:
    """Enterprise-grade request signer with multiple security algorithms"""
    
    def __init__(self, credentials: Optional[AuthCredentials], options: SigningOptions = None):
        self.credentials = credentials
        self.default_options = options or SigningOptions()
        if self.default_options.include_headers is None:
            self.default_options.include_headers = ['content-type', 'x-timestamp']
    
    async def sign_request(
        self,
        method: str,
        path: str,
        body: str = '',
        timestamp: Optional[str] = None,
        options: Optional[SigningOptions] = None
    ) -> SignedRequest:
        """Sign an HTTP request for API authentication"""
        if not self.credentials:
            raise ValueError("Authentication credentials not provided")
            
        opts = options or self.default_options
        timestamp = timestamp or str(int(time.time() * 1000))
        nonce = self._generate_nonce() if opts.nonce else None
        
        # Build signature components
        components = self._build_signature_components(
            method=method,
            path=path,
            timestamp=timestamp,
            nonce=nonce,
            body=body if opts.include_body else None
        )
        
        # Generate signature
        signature = await self._generate_signature(components, opts.algorithm)
        
        # Build headers
        headers = self._build_auth_headers(
            api_key=self.credentials.api_key,
            timestamp=timestamp,
            nonce=nonce,
            signature=signature,
            passphrase=self.credentials.passphrase
        )
        
        return SignedRequest(
            method=method,
            path=path,
            body=body,
            timestamp=timestamp,
            signature=signature,
            headers=headers
        )
    
    async def verify_request(
        self,
        request: SignedRequest,
        secret: str,
        options: Optional[SigningOptions] = None
    ) -> bool:
        """Verify a signed request (for webhook validation)"""
        try:
            opts = options or self.default_options
            
            # Check timestamp tolerance
            if opts.timestamp_tolerance > 0:
                request_time = int(request.timestamp)
                current_time = int(time.time() * 1000)
                time_diff = abs(current_time - request_time)
                
                if time_diff > opts.timestamp_tolerance:
                    return False
            
            # Reconstruct signature components
            nonce = self._extract_nonce_from_headers(request.headers)
            components = self._build_signature_components(
                method=request.method,
                path=request.path,
                timestamp=request.timestamp,
                nonce=nonce,
                body=request.body if opts.include_body else None
            )
            
            # Generate expected signature
            expected_signature = await self._generate_signature_with_secret(
                components, secret, opts.algorithm
            )
            
            # Timing-safe comparison
            return self._compare_signatures(request.signature, expected_signature)
            
        except Exception as e:
            print(f"Request verification failed: {e}")
            return False
    
    async def _generate_signature(self, components: SignatureComponents, algorithm: str) -> str:
        """Generate signature from components"""
        if not self.credentials or not self.credentials.api_secret:
            raise ValueError("API secret not provided")
            
        return await self._generate_signature_with_secret(
            components, self.credentials.api_secret, algorithm
        )
    
    async def _generate_signature_with_secret(
        self, components: SignatureComponents, secret: str, algorithm: str
    ) -> str:
        """Generate signature with provided secret"""
        message = self._build_signature_string(components)
        
        if algorithm == 'HMAC-SHA256':
            return hmac.new(
                secret.encode('utf-8'),
                message.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()
        elif algorithm == 'HMAC-SHA512':
            return hmac.new(
                secret.encode('utf-8'),
                message.encode('utf-8'),
                hashlib.sha512
            ).hexdigest()
        else:
            raise ValueError(f"Unsupported signing algorithm: {algorithm}")
    
    def _build_signature_components(
        self,
        method: str,
        path: str,
        timestamp: str,
        nonce: Optional[str] = None,
        body: Optional[str] = None
    ) -> SignatureComponents:
        """Build signature components for message construction"""
        return SignatureComponents(
            method=method.upper(),
            path=path,
            timestamp=timestamp,
            nonce=nonce,
            body=self._normalize_body(body) if body else None
        )
    
    def _build_signature_string(self, components: SignatureComponents) -> str:
        """Build the string to be signed"""
        parts = [
            components.method,
            components.path,
            components.timestamp
        ]
        
        if components.nonce:
            parts.append(components.nonce)
            
        if components.body is not None:
            parts.append(components.body)
            
        if components.headers:
            parts.append(components.headers)
            
        return '\n'.join(parts)
    
    def _build_auth_headers(
        self,
        api_key: str,
        timestamp: str,
        nonce: Optional[str],
        signature: str,
        passphrase: Optional[str]
    ) -> Dict[str, str]:
        """Build authentication headers"""
        headers = {
            'X-API-Key': api_key,
            'X-Timestamp': timestamp,
            'X-Signature': signature
        }
        
        if nonce:
            headers['X-Nonce'] = nonce
            
        if passphrase:
            headers['X-Passphrase'] = passphrase
            
        return headers
    
    def _generate_nonce(self, length: int = 16) -> str:
        """Generate cryptographically secure nonce"""
        return secrets.token_hex(length)
    
    def _normalize_body(self, body: str) -> str:
        """Normalize request body for consistent signing"""
        if not body:
            return ''
            
        try:
            # Parse and re-stringify JSON to normalize formatting
            parsed = json.loads(body)
            return json.dumps(parsed, sort_keys=True, separators=(',', ':'))
        except json.JSONDecodeError:
            # If not JSON, return as-is
            return body
    
    def _extract_nonce_from_headers(self, headers: Dict[str, str]) -> Optional[str]:
        """Extract nonce from request headers"""
        for key, value in headers.items():
            if key.lower() == 'x-nonce':
                return value
        return None
    
    def _compare_signatures(self, signature1: str, signature2: str) -> bool:
        """Timing-safe signature comparison"""
        if len(signature1) != len(signature2):
            return False
            
        return hmac.compare_digest(signature1.encode(), signature2.encode())
    
    def create_webhook_signature(self, payload: str, secret: str, algorithm: str = 'sha256') -> str:
        """Create signature for webhook payload"""
        return hmac.new(
            secret.encode('utf-8'),
            payload.encode('utf-8'),
            getattr(hashlib, algorithm)
        ).hexdigest()
    
    def verify_webhook_signature(
        self, payload: str, signature: str, secret: str, algorithm: str = 'sha256'
    ) -> bool:
        """Verify webhook signature"""
        expected_signature = self.create_webhook_signature(payload, secret, algorithm)
        return self._compare_signatures(signature, expected_signature)
    
    @staticmethod
    def generate_api_key_pair() -> Dict[str, str]:
        """Generate API key pair for development/testing"""
        api_key = 'sk_' + secrets.token_hex(16)
        api_secret = secrets.token_hex(32)
        
        return {'api_key': api_key, 'api_secret': api_secret}
    
    @staticmethod
    def hash_for_logging(data: str) -> str:
        """Hash sensitive data for logging"""
        return hashlib.sha256(data.encode()).hexdigest()[:8]
    
    @staticmethod
    def validate_api_key(api_key: str) -> bool:
        """Validate API key format"""
        import re
        return bool(re.match(r'^sk_[a-f0-9]{32}$', api_key))
    
    @staticmethod
    def validate_api_secret(api_secret: str) -> bool:
        """Validate API secret format"""
        import re
        return bool(re.match(r'^[a-f0-9]{64}$', api_secret))

# Utility functions
def create_request_signer(
    credentials: AuthCredentials, options: Optional[SigningOptions] = None
) -> RequestSigner:
    """Create a configured request signer"""
    return RequestSigner(credentials, options)

async def sign_request(
    method: str,
    path: str,
    body: str,
    credentials: AuthCredentials,
    options: Optional[SigningOptions] = None
) -> SignedRequest:
    """Utility function for quick request signing"""
    signer = RequestSigner(credentials, options)
    return await signer.sign_request(method, path, body)

def verify_webhook_signature(
    payload: str, signature: str, secret: str, algorithm: str = 'sha256'
) -> bool:
    """Utility function for webhook signature verification"""
    signer = RequestSigner(None)
    return signer.verify_webhook_signature(payload, signature, secret, algorithm)