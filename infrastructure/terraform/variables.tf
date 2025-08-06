# Variables for DEX Platform Infrastructure

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "dex-platform"
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be one of: dev, staging, production."
  }
}

variable "owner" {
  description = "Owner of the infrastructure"
  type        = string
  default     = "devops-team"
}

# Region Configuration
variable "primary_region" {
  description = "Primary AWS region"
  type        = string
  default     = "us-east-1"
}

variable "secondary_region" {
  description = "Secondary AWS region for disaster recovery"
  type        = string
  default     = "us-west-2"
}

# VPC Configuration
variable "primary_vpc_cidr" {
  description = "CIDR block for primary VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "secondary_vpc_cidr" {
  description = "CIDR block for secondary VPC"
  type        = string
  default     = "10.1.0.0/16"
}

# Kubernetes Configuration
variable "kubernetes_version" {
  description = "Kubernetes version for EKS clusters"
  type        = string
  default     = "1.27"
}

# Auto Scaling Configuration - API Servers
variable "api_servers_min_size" {
  description = "Minimum number of API server nodes"
  type        = number
  default     = 2
}

variable "api_servers_max_size" {
  description = "Maximum number of API server nodes"
  type        = number
  default     = 20
}

variable "api_servers_desired_size" {
  description = "Desired number of API server nodes"
  type        = number
  default     = 3
}

# Auto Scaling Configuration - Workers
variable "workers_min_size" {
  description = "Minimum number of worker nodes"
  type        = number
  default     = 1
}

variable "workers_max_size" {
  description = "Maximum number of worker nodes"
  type        = number
  default     = 10
}

variable "workers_desired_size" {
  description = "Desired number of worker nodes"
  type        = number
  default     = 2
}

# RDS Aurora Configuration
variable "aurora_engine_version" {
  description = "Aurora PostgreSQL engine version"
  type        = string
  default     = "15.3"
}

variable "aurora_instance_class" {
  description = "Instance class for Aurora instances"
  type        = string
  default     = "db.r6g.large"
}

variable "aurora_instance_count" {
  description = "Number of Aurora instances in primary cluster"
  type        = number
  default     = 2
}

variable "aurora_read_replica_count" {
  description = "Number of read replicas in secondary region"
  type        = number
  default     = 1
}

variable "backup_retention_period" {
  description = "Backup retention period in days"
  type        = number
  default     = 7
}

variable "preferred_backup_window" {
  description = "Preferred backup window"
  type        = string
  default     = "03:00-04:00"
}

variable "preferred_maintenance_window" {
  description = "Preferred maintenance window"
  type        = string
  default     = "sun:04:00-sun:05:00"
}

# Database Credentials
variable "db_master_username" {
  description = "Master username for RDS Aurora"
  type        = string
  default     = "postgres"
  sensitive   = true
}

variable "db_master_password" {
  description = "Master password for RDS Aurora"
  type        = string
  sensitive   = true
}

variable "database_name" {
  description = "Name of the database"
  type        = string
  default     = "dex_platform"
}

# Redis Configuration
variable "redis_node_type" {
  description = "Node type for Redis cluster"
  type        = string
  default     = "cache.r6g.large"
}

variable "redis_num_nodes" {
  description = "Number of nodes in Redis cluster"
  type        = number
  default     = 3
}

variable "redis_backup_retention" {
  description = "Redis backup retention period in days"
  type        = number
  default     = 5
}

variable "redis_backup_window" {
  description = "Redis backup window"
  type        = string
  default     = "03:00-05:00"
}

variable "redis_maintenance_window" {
  description = "Redis maintenance window"
  type        = string
  default     = "sun:05:00-sun:07:00"
}

variable "redis_auth_token" {
  description = "Auth token for Redis cluster"
  type        = string
  sensitive   = true
}

# SSL Configuration
variable "ssl_certificate_arn" {
  description = "ARN of SSL certificate for load balancers and CloudFront"
  type        = string
}

# Domain Configuration
variable "domain_name" {
  description = "Domain name for the application"
  type        = string
}

# CloudFront Configuration
variable "cloudfront_price_class" {
  description = "CloudFront price class"
  type        = string
  default     = "PriceClass_100"
  validation {
    condition     = contains(["PriceClass_All", "PriceClass_200", "PriceClass_100"], var.cloudfront_price_class)
    error_message = "CloudFront price class must be one of: PriceClass_All, PriceClass_200, PriceClass_100."
  }
}

# Security Configuration
variable "allowed_cidrs" {
  description = "List of CIDR blocks allowed to access the infrastructure"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# Monitoring Configuration
variable "log_retention_days" {
  description = "Number of days to retain CloudWatch logs"
  type        = number
  default     = 30
}

variable "alert_endpoints" {
  description = "List of endpoints for alerting (email, SMS, etc.)"
  type        = list(string)
  default     = []
}

# Application Secrets
variable "jwt_secret" {
  description = "JWT secret for token signing"
  type        = string
  sensitive   = true
}

variable "trading_engine_api_key" {
  description = "API key for trading engine"
  type        = string
  sensitive   = true
}

variable "market_data_api_key" {
  description = "API key for market data provider"
  type        = string
  sensitive   = true
}

# SSM Parameters
variable "ssm_parameters" {
  description = "Map of SSM parameters to create"
  type        = map(string)
  default = {
    "api/rate_limit"           = "1000"
    "api/max_connections"      = "10000"
    "trading/max_order_size"   = "1000000"
    "trading/min_order_size"   = "1"
    "blockchain/gas_limit"     = "500000"
    "blockchain/confirmation_blocks" = "12"
  }
}

# Feature Flags
variable "enable_cross_region_replication" {
  description = "Enable cross-region database replication"
  type        = bool
  default     = true
}

variable "enable_enhanced_monitoring" {
  description = "Enable enhanced monitoring for RDS"
  type        = bool
  default     = true
}

variable "enable_performance_insights" {
  description = "Enable Performance Insights for Aurora"
  type        = bool
  default     = true
}

variable "enable_deletion_protection" {
  description = "Enable deletion protection for production resources"
  type        = bool
  default     = true
}

# Cost Optimization
variable "use_spot_instances" {
  description = "Use spot instances for worker nodes"
  type        = bool
  default     = true
}

variable "auto_scaling_enabled" {
  description = "Enable auto scaling for node groups"
  type        = bool
  default     = true
}

# Compliance and Security
variable "encryption_at_rest" {
  description = "Enable encryption at rest for all services"
  type        = bool
  default     = true
}

variable "encryption_in_transit" {
  description = "Enable encryption in transit for all services"
  type        = bool
  default     = true
}

variable "enable_waf" {
  description = "Enable WAF for load balancers"
  type        = bool
  default     = true
}

variable "enable_shield" {
  description = "Enable AWS Shield Advanced"
  type        = bool
  default     = false
}

# Backup Configuration
variable "backup_schedule" {
  description = "Backup schedule for critical data"
  type        = string
  default     = "cron(0 2 * * ? *)"  # Daily at 2 AM UTC
}

variable "backup_retention_days" {
  description = "Number of days to retain backups"
  type        = number
  default     = 30
}

# Disaster Recovery
variable "rpo_hours" {
  description = "Recovery Point Objective in hours"
  type        = number
  default     = 1
}

variable "rto_hours" {
  description = "Recovery Time Objective in hours"
  type        = number
  default     = 4
}

# Network Configuration
variable "enable_vpc_flow_logs" {
  description = "Enable VPC flow logs"
  type        = bool
  default     = true
}

variable "enable_dns_hostnames" {
  description = "Enable DNS hostnames in VPC"
  type        = bool
  default     = true
}

variable "enable_dns_support" {
  description = "Enable DNS support in VPC"
  type        = bool
  default     = true
}

# Tagging
variable "additional_tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}

# Environment-specific overrides
variable "environment_config" {
  description = "Environment-specific configuration overrides"
  type = object({
    instance_types = optional(map(list(string)), {})
    scaling_config = optional(map(object({
      min_size     = number
      max_size     = number
      desired_size = number
    })), {})
    database_config = optional(object({
      instance_class    = string
      multi_az         = bool
      backup_retention = number
    }), {
      instance_class    = "db.r6g.large"
      multi_az         = true
      backup_retention = 7
    })
  })
  default = {}
}