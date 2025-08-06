#!/bin/bash

# Network Security Firewall Configuration Script
# Configures iptables rules for Real-time Data Feeds System

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/var/log/firewall-config.log"
BACKUP_DIR="/etc/iptables/backup"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

# Validate script is run as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root"
        exit 1
    fi
}

# Create backup directory
create_backup_dir() {
    mkdir -p "$BACKUP_DIR"
    log "Created backup directory: $BACKUP_DIR"
}

# Backup current iptables rules
backup_current_rules() {
    local backup_file="$BACKUP_DIR/iptables-backup-$(date +%Y%m%d-%H%M%S).rules"
    iptables-save > "$backup_file"
    log "Current iptables rules backed up to: $backup_file"
}

# Clear existing rules
clear_existing_rules() {
    log "Clearing existing iptables rules..."
    iptables -F
    iptables -X
    iptables -t nat -F
    iptables -t nat -X
    iptables -t mangle -F
    iptables -t mangle -X
    log "Existing rules cleared"
}

# Set default policies
set_default_policies() {
    log "Setting default policies..."
    iptables -P INPUT DROP
    iptables -P FORWARD DROP
    iptables -P OUTPUT ACCEPT
    log "Default policies set (INPUT: DROP, FORWARD: DROP, OUTPUT: ACCEPT)"
}

# Allow loopback traffic
allow_loopback() {
    log "Allowing loopback traffic..."
    iptables -A INPUT -i lo -j ACCEPT
    iptables -A OUTPUT -o lo -j ACCEPT
}

# Allow established and related connections
allow_established() {
    log "Allowing established and related connections..."
    iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
}

# Allow SSH access (secure management)
allow_ssh() {
    local ssh_port="${SSH_PORT:-22}"
    log "Allowing SSH access on port $ssh_port..."
    
    # Limit SSH connections to prevent brute force
    iptables -A INPUT -p tcp --dport "$ssh_port" -m conntrack --ctstate NEW -m limit --limit 3/min --limit-burst 3 -j ACCEPT
    iptables -A INPUT -p tcp --dport "$ssh_port" -m conntrack --ctstate NEW -j LOG --log-prefix "SSH_BRUTE_FORCE: "
    iptables -A INPUT -p tcp --dport "$ssh_port" -m conntrack --ctstate NEW -j DROP
}

# Allow HTTP/HTTPS traffic for web services
allow_web_traffic() {
    log "Configuring web traffic rules..."
    
    # Allow HTTP (port 80) - redirect to HTTPS
    iptables -A INPUT -p tcp --dport 80 -j ACCEPT
    
    # Allow HTTPS (port 443)
    iptables -A INPUT -p tcp --dport 443 -j ACCEPT
    
    # Allow custom application port (8080) with rate limiting
    iptables -A INPUT -p tcp --dport 8080 -m conntrack --ctstate NEW -m limit --limit 100/sec --limit-burst 200 -j ACCEPT
    iptables -A INPUT -p tcp --dport 8080 -m conntrack --ctstate NEW -j LOG --log-prefix "APP_RATE_LIMIT: "
    iptables -A INPUT -p tcp --dport 8080 -m conntrack --ctstate NEW -j DROP
}

# Configure WebSocket security
configure_websocket_security() {
    log "Configuring WebSocket security rules..."
    
    # Allow WebSocket connections with connection limits
    iptables -A INPUT -p tcp --dport 8080 -m connlimit --connlimit-above 1000 --connlimit-mask 32 -j LOG --log-prefix "WS_CONN_LIMIT: "
    iptables -A INPUT -p tcp --dport 8080 -m connlimit --connlimit-above 1000 --connlimit-mask 32 -j DROP
    
    # Allow WebSocket handshake with specific user agents
    iptables -A INPUT -p tcp --dport 8080 -m string --string "Upgrade: websocket" --algo bm -j ACCEPT
}

# Configure database access restrictions
configure_database_access() {
    log "Configuring database access restrictions..."
    
    # PostgreSQL (only from application servers)
    # Replace with actual application server IPs
    local app_servers=("10.0.1.10" "10.0.1.11" "10.0.1.12")
    
    for server in "${app_servers[@]}"; do
        iptables -A INPUT -p tcp -s "$server" --dport 5432 -j ACCEPT
    done
    
    # Log unauthorized database access attempts
    iptables -A INPUT -p tcp --dport 5432 -j LOG --log-prefix "UNAUTHORIZED_DB: "
    iptables -A INPUT -p tcp --dport 5432 -j DROP
    
    # Redis (only from application servers)
    for server in "${app_servers[@]}"; do
        iptables -A INPUT -p tcp -s "$server" --dport 6379 -j ACCEPT
    done
    
    # Log unauthorized Redis access attempts
    iptables -A INPUT -p tcp --dport 6379 -j LOG --log-prefix "UNAUTHORIZED_REDIS: "
    iptables -A INPUT -p tcp --dport 6379 -j DROP
}

# Configure monitoring access
configure_monitoring() {
    log "Configuring monitoring access..."
    
    # Prometheus metrics (restricted to monitoring servers)
    local monitoring_servers=("10.0.2.10" "10.0.2.11")
    
    for server in "${monitoring_servers[@]}"; do
        iptables -A INPUT -p tcp -s "$server" --dport 9090 -j ACCEPT
        iptables -A INPUT -p tcp -s "$server" --dport 9100 -j ACCEPT
    done
    
    # Application metrics endpoint
    iptables -A INPUT -p tcp --dport 8080 -m string --string "/metrics" --algo bm -j ACCEPT
}

# Configure DDoS protection
configure_ddos_protection() {
    log "Configuring DDoS protection..."
    
    # SYN flood protection
    iptables -A INPUT -p tcp --syn -m limit --limit 1/s --limit-burst 3 -j ACCEPT
    iptables -A INPUT -p tcp --syn -j LOG --log-prefix "SYN_FLOOD: "
    iptables -A INPUT -p tcp --syn -j DROP
    
    # Ping flood protection
    iptables -A INPUT -p icmp --icmp-type echo-request -m limit --limit 1/s --limit-burst 3 -j ACCEPT
    iptables -A INPUT -p icmp --icmp-type echo-request -j LOG --log-prefix "PING_FLOOD: "
    iptables -A INPUT -p icmp --icmp-type echo-request -j DROP
    
    # Port scan protection
    iptables -A INPUT -m recent --name portscan --rcheck --seconds 86400 -j DROP
    iptables -A INPUT -m recent --name portscan --remove
    iptables -A INPUT -p tcp -m tcp --dport 139 -m recent --name portscan --set -j LOG --log-prefix "PORT_SCAN: "
    iptables -A INPUT -p tcp -m tcp --dport 139 -m recent --name portscan --set -j DROP
}

# Configure geographic IP blocking
configure_geo_blocking() {
    log "Configuring geographic IP blocking..."
    
    # Block known malicious countries (example - customize as needed)
    # This requires ipset and country IP lists
    if command -v ipset &> /dev/null; then
        # Create ipsets for blocked countries
        ipset create blocked_countries hash:net
        
        # Add blocked IP ranges (example)
        # ipset add blocked_countries 1.2.3.0/24
        
        # Block traffic from blocked countries
        iptables -A INPUT -m set --match-set blocked_countries src -j LOG --log-prefix "GEO_BLOCKED: "
        iptables -A INPUT -m set --match-set blocked_countries src -j DROP
    else
        warn "ipset not available, skipping geographic IP blocking"
    fi
}

# Configure application-specific rules
configure_application_rules() {
    log "Configuring application-specific security rules..."
    
    # Block known malicious user agents
    iptables -A INPUT -p tcp --dport 80 -m string --string "sqlmap" --algo bm -j LOG --log-prefix "MALICIOUS_UA: "
    iptables -A INPUT -p tcp --dport 80 -m string --string "sqlmap" --algo bm -j DROP
    
    iptables -A INPUT -p tcp --dport 80 -m string --string "nikto" --algo bm -j LOG --log-prefix "MALICIOUS_UA: "
    iptables -A INPUT -p tcp --dport 80 -m string --string "nikto" --algo bm -j DROP
    
    # Block requests to sensitive paths
    iptables -A INPUT -p tcp --dport 80 -m string --string "/.env" --algo bm -j LOG --log-prefix "SENSITIVE_PATH: "
    iptables -A INPUT -p tcp --dport 80 -m string --string "/.env" --algo bm -j DROP
    
    iptables -A INPUT -p tcp --dport 80 -m string --string "/admin" --algo bm -j LOG --log-prefix "ADMIN_ACCESS: "
}

# Configure logging and alerting
configure_logging() {
    log "Configuring security logging..."
    
    # Log dropped packets (limited to prevent log flooding)
    iptables -A INPUT -m limit --limit 5/min --limit-burst 10 -j LOG --log-prefix "DROPPED: "
    iptables -A INPUT -j DROP
    
    # Configure rsyslog for firewall logs
    cat > /etc/rsyslog.d/firewall.conf << EOF
# Firewall logs
:msg,contains,"DROPPED:" /var/log/firewall-dropped.log
:msg,contains,"SYN_FLOOD:" /var/log/firewall-attacks.log
:msg,contains,"PORT_SCAN:" /var/log/firewall-attacks.log
:msg,contains,"MALICIOUS_UA:" /var/log/firewall-attacks.log
:msg,contains,"UNAUTHORIZED_DB:" /var/log/firewall-attacks.log
& stop
EOF
    
    systemctl restart rsyslog
}

# Save rules persistently
save_rules() {
    log "Saving iptables rules..."
    
    if command -v iptables-save &> /dev/null; then
        iptables-save > /etc/iptables/rules.v4
        log "Rules saved to /etc/iptables/rules.v4"
    fi
    
    if command -v netfilter-persistent &> /dev/null; then
        netfilter-persistent save
        log "Rules saved with netfilter-persistent"
    fi
}

# Create monitoring script
create_monitoring_script() {
    log "Creating firewall monitoring script..."
    
    cat > /usr/local/bin/firewall-monitor.sh << 'EOF'
#!/bin/bash

# Firewall monitoring and alerting script

ALERT_THRESHOLD=100
LOG_FILE="/var/log/firewall-attacks.log"
ALERT_EMAIL="security@company.com"

# Count attacks in the last hour
attack_count=$(grep "$(date -d '1 hour ago' '+%b %d %H')" "$LOG_FILE" 2>/dev/null | wc -l)

if [ "$attack_count" -gt "$ALERT_THRESHOLD" ]; then
    echo "High number of firewall blocks detected: $attack_count" | \
        mail -s "Firewall Alert: High Attack Volume" "$ALERT_EMAIL"
fi

# Generate daily report
if [ "$(date +%H:%M)" = "08:00" ]; then
    {
        echo "Daily Firewall Report - $(date)"
        echo "================================"
        echo
        echo "Attack Summary:"
        grep "$(date -d yesterday '+%b %d')" "$LOG_FILE" 2>/dev/null | \
            awk '{print $5}' | sort | uniq -c | sort -nr
        echo
        echo "Top Source IPs:"
        grep "$(date -d yesterday '+%b %d')" "$LOG_FILE" 2>/dev/null | \
            grep -oE 'SRC=[0-9.]+' | sort | uniq -c | sort -nr | head -10
    } | mail -s "Daily Firewall Report" "$ALERT_EMAIL"
fi
EOF
    
    chmod +x /usr/local/bin/firewall-monitor.sh
    
    # Add to crontab
    (crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/firewall-monitor.sh") | crontab -
}

# Test firewall configuration
test_firewall() {
    log "Testing firewall configuration..."
    
    # Test that application port is accessible
    if nc -z localhost 8080; then
        log "✓ Application port 8080 is accessible"
    else
        warn "✗ Application port 8080 is not accessible"
    fi
    
    # Test that database port is blocked from external
    if timeout 3 nc -z 8.8.8.8 5432 2>/dev/null; then
        warn "✗ Database port 5432 appears to be externally accessible"
    else
        log "✓ Database port 5432 is properly blocked"
    fi
    
    # Display final rule count
    local rule_count=$(iptables -L | grep -c "^ACCEPT\|^DROP\|^REJECT")
    log "Firewall configuration complete with $rule_count rules"
}

# Main execution
main() {
    log "Starting firewall configuration..."
    
    check_root
    create_backup_dir
    backup_current_rules
    
    clear_existing_rules
    set_default_policies
    allow_loopback
    allow_established
    allow_ssh
    allow_web_traffic
    configure_websocket_security
    configure_database_access
    configure_monitoring
    configure_ddos_protection
    configure_geo_blocking
    configure_application_rules
    configure_logging
    
    save_rules
    create_monitoring_script
    test_firewall
    
    log "Firewall configuration completed successfully"
    log "Monitor logs at: /var/log/firewall-attacks.log"
    log "Monitor script: /usr/local/bin/firewall-monitor.sh"
}

# Parse command line arguments
case "${1:-}" in
    "test")
        test_firewall
        ;;
    "backup")
        check_root
        backup_current_rules
        ;;
    "restore")
        if [[ -z "${2:-}" ]]; then
            error "Please specify backup file to restore"
            exit 1
        fi
        check_root
        iptables-restore < "$2"
        log "Firewall rules restored from $2"
        ;;
    *)
        main
        ;;
esac