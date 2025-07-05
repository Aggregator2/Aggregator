#!/bin/bash

# SSL/TLS Setup Script with Let's Encrypt
# This script automates SSL certificate generation and renewal

set -euo pipefail

# Configuration
DOMAIN="${DOMAIN:-example.com}"
EMAIL="${EMAIL:-admin@example.com}"
STAGING="${STAGING:-false}"
NGINX_CONTAINER="${NGINX_CONTAINER:-trading_nginx}"
CERTBOT_CONTAINER="${CERTBOT_CONTAINER:-trading_certbot}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" >&2
}

warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed"
        exit 1
    fi
    
    # Check if docker-compose is installed
    if ! command -v docker-compose &> /dev/null; then
        error "docker-compose is not installed"
        exit 1
    fi
    
    # Check if containers are running
    if ! docker ps | grep -q "$NGINX_CONTAINER"; then
        error "Nginx container is not running"
        exit 1
    fi
    
    log "Prerequisites check passed"
}

# Initialize SSL directories
init_ssl_directories() {
    log "Initializing SSL directories..."
    
    # Create necessary directories
    mkdir -p ./certbot/conf
    mkdir -p ./certbot/www
    mkdir -p ./nginx/ssl
    
    # Set proper permissions
    chmod 755 ./certbot/conf
    chmod 755 ./certbot/www
    chmod 755 ./nginx/ssl
    
    log "SSL directories initialized"
}

# Generate Diffie-Hellman parameters
generate_dhparams() {
    local dhparam_file="./nginx/ssl/dhparam.pem"
    
    if [ ! -f "$dhparam_file" ]; then
        log "Generating Diffie-Hellman parameters (this may take a while)..."
        openssl dhparam -out "$dhparam_file" 2048
        log "Diffie-Hellman parameters generated"
    else
        log "Diffie-Hellman parameters already exist"
    fi
}

# Create temporary self-signed certificate
create_temp_certificate() {
    local cert_path="./certbot/conf/live/$DOMAIN"
    
    if [ ! -d "$cert_path" ]; then
        log "Creating temporary self-signed certificate..."
        
        mkdir -p "$cert_path"
        
        # Generate self-signed certificate
        openssl req -x509 -nodes -newkey rsa:2048 \
            -keyout "$cert_path/privkey.pem" \
            -out "$cert_path/fullchain.pem" \
            -days 1 \
            -subj "/C=US/ST=State/L=City/O=Organization/CN=$DOMAIN"
        
        # Copy cert as chain
        cp "$cert_path/fullchain.pem" "$cert_path/chain.pem"
        
        log "Temporary certificate created"
    fi
}

# Update Nginx configuration for domain
update_nginx_config() {
    log "Updating Nginx configuration..."
    
    # Replace example.com with actual domain in Nginx config
    sed -i "s/example\.com/$DOMAIN/g" ./nginx/conf.d/trading-platform.conf
    
    # Reload Nginx
    docker exec "$NGINX_CONTAINER" nginx -s reload
    
    log "Nginx configuration updated"
}

# Request Let's Encrypt certificate
request_certificate() {
    log "Requesting Let's Encrypt certificate for $DOMAIN..."
    
    local staging_arg=""
    if [ "$STAGING" = "true" ]; then
        staging_arg="--staging"
        warning "Using Let's Encrypt staging environment"
    fi
    
    # Run certbot
    docker-compose run --rm certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        --force-renewal \
        $staging_arg \
        -d "$DOMAIN" \
        -d "www.$DOMAIN"
    
    if [ $? -eq 0 ]; then
        log "Certificate successfully obtained"
    else
        error "Failed to obtain certificate"
        exit 1
    fi
}

# Setup auto-renewal
setup_auto_renewal() {
    log "Setting up auto-renewal..."
    
    # Create renewal script
    cat > ./scripts/renew-certificates.sh << 'EOF'
#!/bin/bash

# Certificate renewal script
COMPOSE_FILE="/opt/trading-platform/deployment/docker-compose.yml"
LOG_FILE="/var/log/letsencrypt-renewal.log"

echo "[$(date)] Starting certificate renewal check..." >> "$LOG_FILE"

# Run certbot renewal
cd /opt/trading-platform/deployment
docker-compose run --rm certbot renew >> "$LOG_FILE" 2>&1

# Check if renewal was successful
if [ $? -eq 0 ]; then
    echo "[$(date)] Certificate renewal successful" >> "$LOG_FILE"
    
    # Reload Nginx to pick up new certificates
    docker-compose exec -T nginx nginx -s reload >> "$LOG_FILE" 2>&1
    
    # Send notification
    if [ -n "$SLACK_WEBHOOK" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data '{"text":"✅ SSL certificates renewed successfully"}' \
            "$SLACK_WEBHOOK" 2>/dev/null || true
    fi
else
    echo "[$(date)] Certificate renewal failed" >> "$LOG_FILE"
    
    # Send alert
    if [ -n "$SLACK_WEBHOOK" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data '{"text":"❌ SSL certificate renewal failed! Check logs."}' \
            "$SLACK_WEBHOOK" 2>/dev/null || true
    fi
fi

echo "[$(date)] Certificate renewal check completed" >> "$LOG_FILE"
EOF

    chmod +x ./scripts/renew-certificates.sh
    
    # Add cron job for renewal
    cat > ./scripts/certbot-cron << EOF
# Let's Encrypt certificate renewal
# Run twice daily at random times to spread load
0 */12 * * * /opt/trading-platform/deployment/scripts/renew-certificates.sh >> /var/log/letsencrypt-renewal.log 2>&1
EOF
    
    log "Auto-renewal setup completed"
}

# Verify SSL configuration
verify_ssl() {
    log "Verifying SSL configuration..."
    
    # Wait for Nginx to reload
    sleep 5
    
    # Test HTTPS connection
    if curl -sSf "https://$DOMAIN" -o /dev/null --connect-timeout 10; then
        log "HTTPS is working correctly"
    else
        warning "HTTPS connection test failed - certificate may still be propagating"
    fi
    
    # Test SSL certificate
    echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | \
        openssl x509 -noout -dates -issuer
    
    log "SSL verification completed"
}

# Generate SSL security configuration
generate_ssl_config() {
    log "Generating SSL security configuration..."
    
    cat > ./nginx/ssl/ssl-params.conf << 'EOF'
# SSL Security Configuration

# SSL protocols - only use TLSv1.2 and TLSv1.3
ssl_protocols TLSv1.2 TLSv1.3;

# SSL ciphers - modern configuration
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;

# Prefer server ciphers
ssl_prefer_server_ciphers off;

# OCSP stapling
ssl_stapling on;
ssl_stapling_verify on;

# SSL session caching
ssl_session_timeout 1d;
ssl_session_cache shared:SSL:50m;
ssl_session_tickets off;

# Diffie-Hellman parameters
ssl_dhparam /etc/nginx/ssl/dhparam.pem;

# HSTS (HTTP Strict Transport Security)
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

# Other security headers
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self' https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' https: wss:; media-src 'self' https:; object-src 'none'; frame-src 'self' https:; base-uri 'self'; form-action 'self' https:; frame-ancestors 'none'; upgrade-insecure-requests;" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()" always;

# Certificate Transparency
add_header Expect-CT "max-age=86400, enforce" always;
EOF
    
    log "SSL security configuration generated"
}

# Main execution
main() {
    log "=== SSL/TLS Setup Script Started ==="
    
    # Validate inputs
    if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "example.com" ]; then
        error "Please set the DOMAIN environment variable"
        exit 1
    fi
    
    if [ -z "$EMAIL" ] || [ "$EMAIL" = "admin@example.com" ]; then
        error "Please set the EMAIL environment variable"
        exit 1
    fi
    
    # Run setup steps
    check_prerequisites
    init_ssl_directories
    generate_dhparams
    create_temp_certificate
    update_nginx_config
    generate_ssl_config
    
    # Request certificate
    request_certificate
    
    # Reload Nginx with real certificate
    docker exec "$NGINX_CONTAINER" nginx -s reload
    
    # Setup auto-renewal
    setup_auto_renewal
    
    # Verify SSL
    verify_ssl
    
    log "=== SSL/TLS Setup Completed Successfully ==="
    log ""
    log "Next steps:"
    log "1. Add the renewal cron job: sudo crontab ./scripts/certbot-cron"
    log "2. Test your SSL configuration at: https://www.ssllabs.com/ssltest/"
    log "3. Monitor certificate expiration"
}

# Show usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Options:
    -d, --domain DOMAIN    Domain name (required)
    -e, --email EMAIL      Email for Let's Encrypt (required)
    -s, --staging          Use Let's Encrypt staging environment
    -h, --help             Show this help message

Example:
    $0 --domain example.com --email admin@example.com

Environment variables:
    DOMAIN                 Domain name
    EMAIL                  Email address
    STAGING                Use staging environment (true/false)
    NGINX_CONTAINER        Nginx container name
    CERTBOT_CONTAINER      Certbot container name
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--domain)
            DOMAIN="$2"
            shift 2
            ;;
        -e|--email)
            EMAIL="$2"
            shift 2
            ;;
        -s|--staging)
            STAGING="true"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Run main function
main