#!/bin/bash

# SwappiQ Protocol Monitoring Stack Deployment Script
# Author: SwappiQ Protocol
# Description: Automated deployment of comprehensive monitoring and observability stack

set -euo pipefail

# Configuration
MONITORING_NAMESPACE="swappiq-monitoring"
PROMETHEUS_VERSION="v2.40.0"
GRAFANA_VERSION="9.3.0"
ALERTMANAGER_VERSION="v0.25.0"
ELASTICSEARCH_VERSION="8.5.0"
LOGSTASH_VERSION="8.5.0"
KIBANA_VERSION="8.5.0"
JAEGER_VERSION="1.39.0"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if running as root or with sudo
    if [[ $EUID -eq 0 ]]; then
        log_warning "Running as root - ensure this is intended for production deployment"
    fi
    
    # Check required commands
    local required_commands=("docker" "docker-compose" "curl" "jq")
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            log_error "$cmd is required but not installed"
            exit 1
        fi
    done
    
    # Check Docker daemon
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        exit 1
    fi
    
    # Check available disk space (minimum 20GB)
    local available_space=$(df / | awk 'NR==2 {print $4}')
    if [[ $available_space -lt 20971520 ]]; then
        log_warning "Less than 20GB disk space available. Monitoring stack may require more space."
    fi
    
    log_success "Prerequisites check completed"
}

# Create monitoring directories
create_directories() {
    log_info "Creating monitoring directories..."
    
    local directories=(
        "/var/lib/swappiq-monitoring/prometheus/data"
        "/var/lib/swappiq-monitoring/grafana/data"
        "/var/lib/swappiq-monitoring/alertmanager/data"
        "/var/lib/swappiq-monitoring/elasticsearch/data"
        "/var/lib/swappiq-monitoring/jaeger/data"
        "/etc/swappiq-monitoring/prometheus"
        "/etc/swappiq-monitoring/grafana"
        "/etc/swappiq-monitoring/alertmanager"
        "/etc/swappiq-monitoring/elasticsearch"
        "/etc/swappiq-monitoring/logstash"
        "/etc/swappiq-monitoring/kibana"
        "/etc/swappiq-monitoring/jaeger"
        "/var/log/swappiq-monitoring"
        "/opt/swappiq-monitoring/certs"
        "/opt/swappiq-monitoring/secrets"
    )
    
    for dir in "${directories[@]}"; do
        mkdir -p "$dir"
        chmod 755 "$dir"
    done
    
    # Set proper ownership for data directories
    chown -R 472:472 /var/lib/swappiq-monitoring/grafana  # Grafana user
    chown -R 1000:1000 /var/lib/swappiq-monitoring/prometheus  # Prometheus user
    chown -R 1000:1000 /var/lib/swappiq-monitoring/elasticsearch  # Elasticsearch user
    
    log_success "Monitoring directories created"
}

# Generate SSL certificates
generate_certificates() {
    log_info "Generating SSL certificates..."
    
    local cert_dir="/opt/swappiq-monitoring/certs"
    cd "$cert_dir"
    
    # Generate CA private key
    openssl genrsa -out ca.key 4096
    
    # Generate CA certificate
    openssl req -new -x509 -days 365 -key ca.key -out ca.crt -subj "/C=US/ST=CA/L=San Francisco/O=SwappiQ/OU=Monitoring/CN=SwappiQ-CA"
    
    # Generate server private key
    openssl genrsa -out server.key 4096
    
    # Generate server certificate signing request
    openssl req -new -key server.key -out server.csr -subj "/C=US/ST=CA/L=San Francisco/O=SwappiQ/OU=Monitoring/CN=monitoring.swappiq.com"
    
    # Generate server certificate
    openssl x509 -req -days 365 -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt
    
    # Generate client private key
    openssl genrsa -out client.key 4096
    
    # Generate client certificate signing request
    openssl req -new -key client.key -out client.csr -subj "/C=US/ST=CA/L=San Francisco/O=SwappiQ/OU=Monitoring/CN=monitoring-client"
    
    # Generate client certificate
    openssl x509 -req -days 365 -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt
    
    # Set proper permissions
    chmod 600 *.key
    chmod 644 *.crt
    
    log_success "SSL certificates generated"
}

# Copy configuration files
copy_configurations() {
    log_info "Copying configuration files..."
    
    # Prometheus configuration
    cp /workspace/monitoring/prometheus/prometheus.yml /etc/swappiq-monitoring/prometheus/
    cp /workspace/monitoring/prometheus/rules/*.yml /etc/swappiq-monitoring/prometheus/
    
    # Grafana configuration
    cp -r /workspace/monitoring/grafana/dashboards /etc/swappiq-monitoring/grafana/
    
    # Alertmanager configuration
    cp /workspace/monitoring/alertmanager/alertmanager.yml /etc/swappiq-monitoring/alertmanager/
    
    # Elasticsearch configuration
    cp /workspace/monitoring/elasticsearch/*.json /etc/swappiq-monitoring/elasticsearch/
    cp /workspace/monitoring/elasticsearch/logstash-swappiq.conf /etc/swappiq-monitoring/logstash/
    
    # Jaeger configuration
    cp /workspace/monitoring/jaeger/jaeger-config.yml /etc/swappiq-monitoring/jaeger/
    
    # Kibana dashboards
    cp /workspace/monitoring/kibana/dashboards/*.json /etc/swappiq-monitoring/kibana/
    
    log_success "Configuration files copied"
}

# Create Docker Compose file
create_docker_compose() {
    log_info "Creating Docker Compose configuration..."
    
    cat > /opt/swappiq-monitoring/docker-compose.yml << 'EOF'
version: '3.8'

networks:
  monitoring:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

volumes:
  prometheus_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /var/lib/swappiq-monitoring/prometheus/data
  grafana_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /var/lib/swappiq-monitoring/grafana/data
  elasticsearch_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /var/lib/swappiq-monitoring/elasticsearch/data
  alertmanager_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /var/lib/swappiq-monitoring/alertmanager/data

services:
  # Prometheus
  prometheus:
    image: prom/prometheus:v2.40.0
    container_name: swappiq-prometheus
    restart: unless-stopped
    ports:
      - "9090:9090"
    networks:
      monitoring:
        ipv4_address: 172.20.0.10
    volumes:
      - prometheus_data:/prometheus
      - /etc/swappiq-monitoring/prometheus:/etc/prometheus:ro
      - /opt/swappiq-monitoring/certs:/etc/ssl/certs:ro
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
      - '--storage.tsdb.retention.size=50GB'
      - '--web.console.libraries=/etc/prometheus/console_libraries'
      - '--web.console.templates=/etc/prometheus/consoles'
      - '--web.enable-lifecycle'
      - '--web.enable-admin-api'
      - '--log.level=info'
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:9090/-/healthy"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Alertmanager
  alertmanager:
    image: prom/alertmanager:v0.25.0
    container_name: swappiq-alertmanager
    restart: unless-stopped
    ports:
      - "9093:9093"
    networks:
      monitoring:
        ipv4_address: 172.20.0.11
    volumes:
      - alertmanager_data:/alertmanager
      - /etc/swappiq-monitoring/alertmanager:/etc/alertmanager:ro
      - /opt/swappiq-monitoring/secrets:/etc/alertmanager/secrets:ro
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'
      - '--storage.path=/alertmanager'
      - '--web.external-url=http://localhost:9093'
      - '--cluster.listen-address='
      - '--log.level=info'
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:9093/-/healthy"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Grafana
  grafana:
    image: grafana/grafana:9.3.0
    container_name: swappiq-grafana
    restart: unless-stopped
    ports:
      - "3000:3000"
    networks:
      monitoring:
        ipv4_address: 172.20.0.12
    volumes:
      - grafana_data:/var/lib/grafana
      - /etc/swappiq-monitoring/grafana:/etc/grafana/provisioning:ro
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-admin123}
      - GF_INSTALL_PLUGINS=grafana-clock-panel,grafana-simple-json-datasource
      - GF_SECURITY_ALLOW_EMBEDDING=true
      - GF_AUTH_ANONYMOUS_ENABLED=false
      - GF_SECURITY_COOKIE_SECURE=true
      - GF_SERVER_PROTOCOL=https
      - GF_SERVER_CERT_FILE=/etc/ssl/certs/server.crt
      - GF_SERVER_CERT_KEY=/etc/ssl/certs/server.key
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Elasticsearch
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.5.0
    container_name: swappiq-elasticsearch
    restart: unless-stopped
    ports:
      - "9200:9200"
      - "9300:9300"
    networks:
      monitoring:
        ipv4_address: 172.20.0.20
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data
      - /etc/swappiq-monitoring/elasticsearch:/usr/share/elasticsearch/config/templates:ro
    environment:
      - cluster.name=swappiq-logs
      - node.name=swappiq-elasticsearch-1
      - discovery.type=single-node
      - bootstrap.memory_lock=true
      - "ES_JAVA_OPTS=-Xms2g -Xmx2g"
      - xpack.security.enabled=true
      - xpack.security.http.ssl.enabled=true
      - xpack.security.transport.ssl.enabled=true
      - ELASTIC_PASSWORD=${ELASTICSEARCH_PASSWORD:-elastic123}
    ulimits:
      memlock:
        soft: -1
        hard: -1
      nofile:
        soft: 65536
        hard: 65536
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9200/_cluster/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Logstash
  logstash:
    image: docker.elastic.co/logstash/logstash:8.5.0
    container_name: swappiq-logstash
    restart: unless-stopped
    ports:
      - "5044:5044"
      - "5000:5000/tcp"
      - "5001:5001/tcp"
      - "5002:5002/tcp"
      - "5003:5003/tcp"
      - "5004:5004/tcp"
      - "9600:9600"
    networks:
      monitoring:
        ipv4_address: 172.20.0.21
    volumes:
      - /etc/swappiq-monitoring/logstash:/usr/share/logstash/pipeline:ro
      - /etc/swappiq-monitoring/elasticsearch:/usr/share/logstash/templates:ro
    environment:
      - "LS_JAVA_OPTS=-Xmx1g -Xms1g"
      - ELASTICSEARCH_PASSWORD=${ELASTICSEARCH_PASSWORD:-elastic123}
    depends_on:
      - elasticsearch
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9600 || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Kibana
  kibana:
    image: docker.elastic.co/kibana/kibana:8.5.0
    container_name: swappiq-kibana
    restart: unless-stopped
    ports:
      - "5601:5601"
    networks:
      monitoring:
        ipv4_address: 172.20.0.22
    volumes:
      - /etc/swappiq-monitoring/kibana:/usr/share/kibana/config/dashboards:ro
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
      - ELASTICSEARCH_USERNAME=elastic
      - ELASTICSEARCH_PASSWORD=${ELASTICSEARCH_PASSWORD:-elastic123}
      - SERVER_NAME=kibana.swappiq.com
      - SERVER_BASEPATH=/kibana
    depends_on:
      - elasticsearch
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:5601/api/status || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Jaeger
  jaeger:
    image: jaegertracing/all-in-one:1.39
    container_name: swappiq-jaeger
    restart: unless-stopped
    ports:
      - "16686:16686"
      - "14268:14268"
      - "14250:14250"
      - "6831:6831/udp"
      - "6832:6832/udp"
    networks:
      monitoring:
        ipv4_address: 172.20.0.30
    environment:
      - COLLECTOR_ZIPKIN_HOST_PORT=:9411
      - SPAN_STORAGE_TYPE=elasticsearch
      - ES_SERVER_URLS=http://elasticsearch:9200
      - ES_USERNAME=elastic
      - ES_PASSWORD=${ELASTICSEARCH_PASSWORD:-elastic123}
    depends_on:
      - elasticsearch
    healthcheck:
      test: ["CMD-SHELL", "wget --quiet --tries=1 --spider http://localhost:16687 || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Business Metrics Collector
  business-metrics:
    build:
      context: /workspace/monitoring/metrics
      dockerfile: Dockerfile
    container_name: swappiq-business-metrics
    restart: unless-stopped
    ports:
      - "8090:8090"
      - "8091:8091"
    networks:
      monitoring:
        ipv4_address: 172.20.0.40
    environment:
      - NODE_ENV=production
      - METRICS_PORT=8090
      - WS_METRICS_PORT=8091
      - REDIS_HOST=${REDIS_HOST:-redis}
      - REDIS_PORT=${REDIS_PORT:-6379}
      - DB_HOST=${DB_HOST:-postgres}
      - DB_PORT=${DB_PORT:-5432}
      - DB_NAME=${DB_NAME:-swappiq}
      - DB_USER=${DB_USER:-postgres}
      - DB_PASSWORD=${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8090/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

  # SLA Monitor
  sla-monitor:
    build:
      context: /workspace/monitoring/sla
      dockerfile: Dockerfile
    container_name: swappiq-sla-monitor
    restart: unless-stopped
    ports:
      - "8092:8092"
    networks:
      monitoring:
        ipv4_address: 172.20.0.41
    volumes:
      - /workspace/monitoring/sla/sla-config.yml:/app/sla-config.yml:ro
    environment:
      - NODE_ENV=production
      - SLA_MONITOR_PORT=8092
    depends_on:
      - prometheus
      - grafana
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8092/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Node Exporter for system metrics
  node-exporter:
    image: prom/node-exporter:latest
    container_name: swappiq-node-exporter
    restart: unless-stopped
    ports:
      - "9100:9100"
    networks:
      monitoring:
        ipv4_address: 172.20.0.50
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.rootfs=/rootfs'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:9100/metrics"]
      interval: 30s
      timeout: 10s
      retries: 3
EOF

    log_success "Docker Compose configuration created"
}

# Create Dockerfiles for custom services
create_dockerfiles() {
    log_info "Creating Dockerfiles for custom services..."
    
    # Business Metrics Collector Dockerfile
    cat > /workspace/monitoring/metrics/Dockerfile << 'EOF'
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 8090 8091

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8090/health || exit 1

CMD ["node", "business-metrics-collector.js"]
EOF

    # SLA Monitor Dockerfile
    cat > /workspace/monitoring/sla/Dockerfile << 'EOF'
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 8092

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8092/health || exit 1

CMD ["node", "sla-monitor.js"]
EOF

    log_success "Dockerfiles created"
}

# Create package.json files
create_package_files() {
    log_info "Creating package.json files..."
    
    # Business Metrics package.json
    cat > /workspace/monitoring/metrics/package.json << 'EOF'
{
  "name": "swappiq-business-metrics",
  "version": "1.0.0",
  "description": "Business metrics collector for SwappiQ Protocol",
  "main": "business-metrics-collector.js",
  "scripts": {
    "start": "node business-metrics-collector.js",
    "dev": "nodemon business-metrics-collector.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "prom-client": "^14.2.0",
    "ioredis": "^5.3.2",
    "pg": "^8.8.0",
    "ws": "^8.13.0"
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
EOF

    # SLA Monitor package.json
    cat > /workspace/monitoring/sla/package.json << 'EOF'
{
  "name": "swappiq-sla-monitor",
  "version": "1.0.0",
  "description": "SLA monitoring service for SwappiQ Protocol",
  "main": "sla-monitor.js",
  "scripts": {
    "start": "node sla-monitor.js",
    "dev": "nodemon sla-monitor.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "prom-client": "^14.2.0",
    "js-yaml": "^4.1.0",
    "node-cron": "^3.0.2",
    "axios": "^1.4.0",
    "pdfkit": "^0.13.0",
    "nodemailer": "^6.9.3"
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
EOF

    log_success "Package.json files created"
}

# Deploy monitoring stack
deploy_stack() {
    log_info "Deploying monitoring stack..."
    
    cd /opt/swappiq-monitoring
    
    # Pull images first
    log_info "Pulling Docker images..."
    docker-compose pull
    
    # Build custom images
    log_info "Building custom services..."
    docker-compose build
    
    # Start services
    log_info "Starting monitoring services..."
    docker-compose up -d
    
    # Wait for services to be healthy
    log_info "Waiting for services to be healthy..."
    sleep 30
    
    # Check service health
    local services=("prometheus" "grafana" "elasticsearch" "logstash" "kibana" "jaeger" "alertmanager")
    for service in "${services[@]}"; do
        if docker-compose ps "$service" | grep -q "Up (healthy)"; then
            log_success "$service is healthy"
        else
            log_warning "$service may not be fully ready yet"
        fi
    done
    
    log_success "Monitoring stack deployed"
}

# Configure initial dashboards and alerts
configure_initial_setup() {
    log_info "Configuring initial setup..."
    
    # Wait for Grafana to be ready
    sleep 60
    
    # Import Grafana dashboards
    log_info "Importing Grafana dashboards..."
    local grafana_url="http://localhost:3000"
    local grafana_auth="admin:${GRAFANA_ADMIN_PASSWORD:-admin123}"
    
    # Configure Prometheus data source
    curl -X POST -H "Content-Type: application/json" \
         -u "$grafana_auth" \
         -d '{
           "name": "Prometheus",
           "type": "prometheus",
           "url": "http://prometheus:9090",
           "access": "proxy",
           "isDefault": true
         }' \
         "$grafana_url/api/datasources" || log_warning "Failed to configure Prometheus datasource"
    
    # Configure Elasticsearch data source for logs
    curl -X POST -H "Content-Type: application/json" \
         -u "$grafana_auth" \
         -d '{
           "name": "Elasticsearch-Logs",
           "type": "elasticsearch",
           "url": "http://elasticsearch:9200",
           "access": "proxy",
           "database": "swappiq-*",
           "basicAuth": true,
           "basicAuthUser": "elastic",
           "basicAuthPassword": "'"${ELASTICSEARCH_PASSWORD:-elastic123}"'"
         }' \
         "$grafana_url/api/datasources" || log_warning "Failed to configure Elasticsearch datasource"
    
    log_success "Initial configuration completed"
}

# Create monitoring status script
create_status_script() {
    log_info "Creating monitoring status script..."
    
    cat > /opt/swappiq-monitoring/status.sh << 'EOF'
#!/bin/bash

echo "SwappiQ Monitoring Stack Status"
echo "================================"
echo ""

cd /opt/swappiq-monitoring

# Check Docker Compose services
echo "Docker Services Status:"
docker-compose ps
echo ""

# Check individual service health
echo "Service Health Checks:"
services=("prometheus:9090" "grafana:3000" "elasticsearch:9200" "kibana:5601" "jaeger:16686" "alertmanager:9093")

for service in "${services[@]}"; do
    IFS=':' read -r name port <<< "$service"
    if curl -s "http://localhost:$port" > /dev/null 2>&1; then
        echo "✓ $name is responding on port $port"
    else
        echo "✗ $name is not responding on port $port"
    fi
done

echo ""
echo "Access URLs:"
echo "- Prometheus: http://localhost:9090"
echo "- Grafana: http://localhost:3000 (admin/admin123)"
echo "- Elasticsearch: http://localhost:9200"
echo "- Kibana: http://localhost:5601"
echo "- Jaeger: http://localhost:16686"
echo "- Alertmanager: http://localhost:9093"
echo "- Business Metrics: http://localhost:8090/metrics"
echo "- SLA Monitor: http://localhost:8092/sla/status"
EOF

    chmod +x /opt/swappiq-monitoring/status.sh
    
    log_success "Status script created at /opt/swappiq-monitoring/status.sh"
}

# Main deployment function
main() {
    log_info "Starting SwappiQ Monitoring Stack Deployment"
    echo ""
    
    check_prerequisites
    create_directories
    generate_certificates
    copy_configurations
    create_docker_compose
    create_dockerfiles
    create_package_files
    deploy_stack
    configure_initial_setup
    create_status_script
    
    echo ""
    log_success "SwappiQ Monitoring Stack deployment completed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Check service status: /opt/swappiq-monitoring/status.sh"
    echo "2. Access Grafana at http://localhost:3000 (admin/admin123)"
    echo "3. Configure additional data sources and alerts as needed"
    echo "4. Review logs: docker-compose -f /opt/swappiq-monitoring/docker-compose.yml logs -f"
    echo ""
    echo "For production deployment, remember to:"
    echo "- Change default passwords"
    echo "- Configure proper SSL certificates"
    echo "- Set up backup procedures"
    echo "- Configure firewall rules"
    echo "- Review resource limits and scaling"
}

# Script entry point
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi