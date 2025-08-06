#!/bin/bash
# PgBouncer setup script for high-frequency trading system

set -e

echo "Setting up PgBouncer for high-performance connection pooling..."

# Install PgBouncer if not already installed
if ! command -v pgbouncer &> /dev/null; then
    echo "Installing PgBouncer..."
    sudo apt-get update
    sudo apt-get install -y pgbouncer
fi

# Create necessary directories
sudo mkdir -p /etc/pgbouncer
sudo mkdir -p /var/log/pgbouncer
sudo mkdir -p /var/run/pgbouncer

# Copy configuration files
sudo cp /workspace/config/pgbouncer.ini /etc/pgbouncer/
sudo cp /workspace/config/pgbouncer-userlist.txt /etc/pgbouncer/userlist.txt

# Set proper permissions
sudo chown postgres:postgres /etc/pgbouncer/pgbouncer.ini
sudo chown postgres:postgres /etc/pgbouncer/userlist.txt
sudo chmod 640 /etc/pgbouncer/userlist.txt

# Create systemd service file
sudo tee /etc/systemd/system/pgbouncer.service > /dev/null <<EOF
[Unit]
Description=PgBouncer connection pooler
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=notify
User=postgres
Group=postgres
ExecStart=/usr/bin/pgbouncer /etc/pgbouncer/pgbouncer.ini
ExecReload=/bin/kill -SIGHUP \$MAINPID
KillSignal=SIGTERM
Restart=on-failure
RestartSec=10s

# Performance tuning
LimitNOFILE=65536
LimitNPROC=65536

[Install]
WantedBy=multi-user.target
EOF

# Create monitoring script
sudo tee /usr/local/bin/pgbouncer-monitor.sh > /dev/null <<'EOF'
#!/bin/bash
# Monitor PgBouncer performance

echo "=== PgBouncer Statistics ==="
echo "SHOW STATS;" | psql -h localhost -p 6432 -U pgbouncer pgbouncer

echo -e "\n=== Pool Status ==="
echo "SHOW POOLS;" | psql -h localhost -p 6432 -U pgbouncer pgbouncer

echo -e "\n=== Client Connections ==="
echo "SHOW CLIENTS;" | psql -h localhost -p 6432 -U pgbouncer pgbouncer

echo -e "\n=== Server Connections ==="
echo "SHOW SERVERS;" | psql -h localhost -p 6432 -U pgbouncer pgbouncer
EOF

sudo chmod +x /usr/local/bin/pgbouncer-monitor.sh

# Create connection test script
sudo tee /usr/local/bin/pgbouncer-test.sh > /dev/null <<'EOF'
#!/bin/bash
# Test PgBouncer connections

echo "Testing PgBouncer connections..."

# Test main pool
psql -h localhost -p 6432 -U app_user -d trading -c "SELECT 'Main pool: OK' as status;"

# Test read replica pool
psql -h localhost -p 6432 -U app_user -d trading_read -c "SELECT 'Read pool: OK' as status;"

# Test matching engine pool
psql -h localhost -p 6432 -U app_user -d trading_matching -c "SELECT 'Matching pool: OK' as status;"

# Test market data pool
psql -h localhost -p 6432 -U app_user -d trading_market -c "SELECT 'Market pool: OK' as status;"

echo "Connection tests completed."
EOF

sudo chmod +x /usr/local/bin/pgbouncer-test.sh

# Reload systemd and start PgBouncer
sudo systemctl daemon-reload
sudo systemctl enable pgbouncer
sudo systemctl restart pgbouncer

# Wait for PgBouncer to start
sleep 5

# Check status
sudo systemctl status pgbouncer --no-pager

echo "PgBouncer setup completed!"
echo ""
echo "Useful commands:"
echo "  - Monitor: sudo /usr/local/bin/pgbouncer-monitor.sh"
echo "  - Test connections: sudo /usr/local/bin/pgbouncer-test.sh"
echo "  - View logs: sudo journalctl -u pgbouncer -f"
echo "  - Reload config: sudo systemctl reload pgbouncer"
echo ""
echo "Connection string: postgresql://app_user:password@localhost:6432/trading"