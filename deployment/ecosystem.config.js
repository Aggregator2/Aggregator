module.exports = {
  apps: [
    {
      name: 'trading-api',
      script: './dist/index.js',
      instances: process.env.PM2_INSTANCES || 4,
      exec_mode: 'cluster',
      instance_var: 'INSTANCE_ID',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        LOG_LEVEL: 'info'
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 3000,
        LOG_LEVEL: 'debug'
      },
      
      // Memory management
      max_memory_restart: '1G',
      node_args: '--max-old-space-size=2048',
      
      // Logging
      log_file: './logs/app/combined.log',
      error_file: './logs/app/error.log',
      out_file: './logs/app/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Restart policies
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      autorestart: true,
      
      // Monitoring
      instance_var: 'INSTANCE_ID',
      pmx: true,
      
      // Graceful shutdown
      kill_timeout: 5000,
      shutdown_with_message: true,
      wait_ready: true,
      listen_timeout: 10000,
      
      // Watch configuration
      watch: false,
      ignore_watch: [
        'node_modules',
        'logs',
        '.git',
        '.env',
        'uploads',
        'temp'
      ],
      
      // Error handling
      error_file: './logs/app/error.log',
      combine_logs: true,
      
      // Environment variables from file
      env_file: './.env.production'
    },
    
    {
      name: 'trading-websocket',
      script: './dist/services/websocket/server.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        WS_PORT: 3001
      },
      env_production: {
        NODE_ENV: 'production',
        WS_PORT: 3001,
        LOG_LEVEL: 'info'
      },
      env_staging: {
        NODE_ENV: 'staging',
        WS_PORT: 3001,
        LOG_LEVEL: 'debug'
      },
      
      // Memory management
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=1024',
      
      // Logging
      log_file: './logs/websocket/combined.log',
      error_file: './logs/websocket/error.log',
      out_file: './logs/websocket/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Restart policies
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      autorestart: true,
      
      // Monitoring
      pmx: true,
      
      // Graceful shutdown
      kill_timeout: 5000,
      
      // Environment variables from file
      env_file: './.env.production'
    },
    
    {
      name: 'trading-worker',
      script: './dist/services/worker/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },
      env_staging: {
        NODE_ENV: 'staging',
        LOG_LEVEL: 'debug'
      },
      
      // Memory management
      max_memory_restart: '2G',
      node_args: '--max-old-space-size=3072',
      
      // Logging
      log_file: './logs/worker/combined.log',
      error_file: './logs/worker/error.log',
      out_file: './logs/worker/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Restart policies
      min_uptime: '10s',
      max_restarts: 5,
      restart_delay: 10000,
      autorestart: true,
      
      // Cron restart
      cron_restart: '0 4 * * *', // Restart daily at 4 AM
      
      // Environment variables from file
      env_file: './.env.production'
    },
    
    {
      name: 'trading-scheduler',
      script: './dist/services/scheduler/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },
      
      // Memory management
      max_memory_restart: '256M',
      
      // Logging
      log_file: './logs/scheduler/combined.log',
      error_file: './logs/scheduler/error.log',
      out_file: './logs/scheduler/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Restart policies
      autorestart: true,
      
      // Environment variables from file
      env_file: './.env.production'
    }
  ],

  // Deployment configuration
  deploy: {
    production: {
      user: 'deploy',
      host: ['server1.example.com', 'server2.example.com'],
      ref: 'origin/main',
      repo: 'git@github.com:example/trading-platform.git',
      path: '/var/www/trading-platform',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      env: {
        NODE_ENV: 'production'
      }
    },
    
    staging: {
      user: 'deploy',
      host: 'staging.example.com',
      ref: 'origin/develop',
      repo: 'git@github.com:example/trading-platform.git',
      path: '/var/www/trading-platform-staging',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env staging',
      env: {
        NODE_ENV: 'staging'
      }
    }
  }
};