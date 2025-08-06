# DEX Platform Infrastructure as Code
# Multi-region, highly available, auto-scaling infrastructure

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.20"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.10"
    }
  }

  backend "s3" {
    bucket         = "dex-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "dex-terraform-locks"
  }
}

# Configure AWS providers for multi-region deployment
provider "aws" {
  region = var.primary_region
  alias  = "primary"

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Owner       = var.owner
    }
  }
}

provider "aws" {
  region = var.secondary_region
  alias  = "secondary"

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Owner       = var.owner
    }
  }
}

# Data sources
data "aws_availability_zones" "primary" {
  provider = aws.primary
  state    = "available"
}

data "aws_availability_zones" "secondary" {
  provider = aws.secondary
  state    = "available"
}

data "aws_caller_identity" "current" {}

# Local values
locals {
  account_id = data.aws_caller_identity.current.account_id
  
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Owner       = var.owner
  }

  primary_azs   = slice(data.aws_availability_zones.primary.names, 0, 3)
  secondary_azs = slice(data.aws_availability_zones.secondary.names, 0, 3)
}

# Primary region VPC
module "vpc_primary" {
  source = "./modules/vpc"
  
  providers = {
    aws = aws.primary
  }

  vpc_cidr             = var.primary_vpc_cidr
  availability_zones   = local.primary_azs
  environment         = var.environment
  project_name        = var.project_name
  region_name         = "primary"
  
  tags = local.common_tags
}

# Secondary region VPC
module "vpc_secondary" {
  source = "./modules/vpc"
  
  providers = {
    aws = aws.secondary
  }

  vpc_cidr             = var.secondary_vpc_cidr
  availability_zones   = local.secondary_azs
  environment         = var.environment
  project_name        = var.project_name
  region_name         = "secondary"
  
  tags = local.common_tags
}

# VPC Peering between regions
resource "aws_vpc_peering_connection" "primary_to_secondary" {
  provider = aws.primary
  
  vpc_id        = module.vpc_primary.vpc_id
  peer_vpc_id   = module.vpc_secondary.vpc_id
  peer_region   = var.secondary_region
  auto_accept   = false

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-${var.environment}-peering"
  })
}

resource "aws_vpc_peering_connection_accepter" "secondary_accept" {
  provider = aws.secondary
  
  vpc_peering_connection_id = aws_vpc_peering_connection.primary_to_secondary.id
  auto_accept               = true

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-${var.environment}-peering-accepter"
  })
}

# EKS Clusters
module "eks_primary" {
  source = "./modules/eks"
  
  providers = {
    aws = aws.primary
  }

  cluster_name        = "${var.project_name}-${var.environment}-primary"
  cluster_version     = var.kubernetes_version
  vpc_id              = module.vpc_primary.vpc_id
  subnet_ids          = module.vpc_primary.private_subnet_ids
  endpoint_private_access = true
  endpoint_public_access  = true
  
  node_groups = {
    api_servers = {
      name           = "api-servers"
      instance_types = ["c5.xlarge", "c5.2xlarge"]
      min_size       = var.api_servers_min_size
      max_size       = var.api_servers_max_size
      desired_size   = var.api_servers_desired_size
      capacity_type  = "ON_DEMAND"
      
      labels = {
        role = "api-server"
        tier = "application"
      }
      
      taints = []
    }
    
    workers = {
      name           = "workers"
      instance_types = ["m5.large", "m5.xlarge"]
      min_size       = var.workers_min_size
      max_size       = var.workers_max_size
      desired_size   = var.workers_desired_size
      capacity_type  = "SPOT"
      
      labels = {
        role = "worker"
        tier = "processing"
      }
      
      taints = []
    }
  }

  tags = local.common_tags
}

module "eks_secondary" {
  source = "./modules/eks"
  
  providers = {
    aws = aws.secondary
  }

  cluster_name        = "${var.project_name}-${var.environment}-secondary"
  cluster_version     = var.kubernetes_version
  vpc_id              = module.vpc_secondary.vpc_id
  subnet_ids          = module.vpc_secondary.private_subnet_ids
  endpoint_private_access = true
  endpoint_public_access  = true
  
  node_groups = {
    api_servers = {
      name           = "api-servers"
      instance_types = ["c5.xlarge", "c5.2xlarge"]
      min_size       = var.api_servers_min_size
      max_size       = var.api_servers_max_size
      desired_size   = var.api_servers_desired_size
      capacity_type  = "ON_DEMAND"
      
      labels = {
        role = "api-server"
        tier = "application"
      }
      
      taints = []
    }
    
    workers = {
      name           = "workers"
      instance_types = ["m5.large", "m5.xlarge"]
      min_size       = var.workers_min_size
      max_size       = var.workers_max_size
      desired_size   = var.workers_desired_size
      capacity_type  = "SPOT"
      
      labels = {
        role = "worker"
        tier = "processing"
      }
      
      taints = []
    }
  }

  tags = local.common_tags
}

# RDS Aurora Clusters
module "aurora_primary" {
  source = "./modules/aurora"
  
  providers = {
    aws = aws.primary
  }

  cluster_identifier     = "${var.project_name}-${var.environment}-primary"
  engine                = "aurora-postgresql"
  engine_version        = var.aurora_engine_version
  master_username       = var.db_master_username
  master_password       = var.db_master_password
  database_name         = var.database_name
  
  vpc_id                = module.vpc_primary.vpc_id
  subnet_ids            = module.vpc_primary.database_subnet_ids
  security_group_ids    = [module.security_groups_primary.aurora_sg_id]
  
  instance_class        = var.aurora_instance_class
  instance_count        = var.aurora_instance_count
  
  # Performance and backup settings
  backup_retention_period = var.backup_retention_period
  preferred_backup_window = var.preferred_backup_window
  preferred_maintenance_window = var.preferred_maintenance_window
  deletion_protection     = var.environment == "production"
  
  # Monitoring and performance insights
  monitoring_interval     = 60
  performance_insights_enabled = true
  
  tags = local.common_tags
}

module "aurora_secondary" {
  source = "./modules/aurora"
  
  providers = {
    aws = aws.secondary
  }

  cluster_identifier     = "${var.project_name}-${var.environment}-secondary"
  engine                = "aurora-postgresql"
  engine_version        = var.aurora_engine_version
  
  # Cross-region read replica configuration
  source_region          = var.primary_region
  source_cluster_identifier = module.aurora_primary.cluster_identifier
  
  vpc_id                = module.vpc_secondary.vpc_id
  subnet_ids            = module.vpc_secondary.database_subnet_ids
  security_group_ids    = [module.security_groups_secondary.aurora_sg_id]
  
  instance_class        = var.aurora_instance_class
  instance_count        = var.aurora_read_replica_count
  
  # Read replica specific settings
  backup_retention_period = 1  # Minimal for read replicas
  deletion_protection     = false
  
  tags = local.common_tags
}

# ElastiCache Redis Clusters
module "redis_primary" {
  source = "./modules/redis"
  
  providers = {
    aws = aws.primary
  }

  cluster_id             = "${var.project_name}-${var.environment}-primary"
  node_type             = var.redis_node_type
  num_cache_nodes       = var.redis_num_nodes
  parameter_group_name  = "default.redis7"
  port                  = 6379
  
  vpc_id                = module.vpc_primary.vpc_id
  subnet_ids            = module.vpc_primary.elasticache_subnet_ids
  security_group_ids    = [module.security_groups_primary.redis_sg_id]
  
  # High availability and backup
  multi_az_enabled      = true
  automatic_failover_enabled = true
  backup_retention_limit = var.redis_backup_retention
  backup_window         = var.redis_backup_window
  maintenance_window    = var.redis_maintenance_window
  
  # Security
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = var.redis_auth_token
  
  tags = local.common_tags
}

module "redis_secondary" {
  source = "./modules/redis"
  
  providers = {
    aws = aws.secondary
  }

  cluster_id             = "${var.project_name}-${var.environment}-secondary"
  node_type             = var.redis_node_type
  num_cache_nodes       = var.redis_num_nodes
  parameter_group_name  = "default.redis7"
  port                  = 6379
  
  vpc_id                = module.vpc_secondary.vpc_id
  subnet_ids            = module.vpc_secondary.elasticache_subnet_ids
  security_group_ids    = [module.security_groups_secondary.redis_sg_id]
  
  # High availability and backup
  multi_az_enabled      = true
  automatic_failover_enabled = true
  backup_retention_limit = var.redis_backup_retention
  backup_window         = var.redis_backup_window
  maintenance_window    = var.redis_maintenance_window
  
  # Security
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = var.redis_auth_token
  
  tags = local.common_tags
}

# Security Groups
module "security_groups_primary" {
  source = "./modules/security-groups"
  
  providers = {
    aws = aws.primary
  }

  vpc_id           = module.vpc_primary.vpc_id
  environment      = var.environment
  project_name     = var.project_name
  allowed_cidrs    = var.allowed_cidrs
  
  tags = local.common_tags
}

module "security_groups_secondary" {
  source = "./modules/security-groups"
  
  providers = {
    aws = aws.secondary
  }

  vpc_id           = module.vpc_secondary.vpc_id
  environment      = var.environment
  project_name     = var.project_name
  allowed_cidrs    = var.allowed_cidrs
  
  tags = local.common_tags
}

# Application Load Balancers
module "alb_primary" {
  source = "./modules/alb"
  
  providers = {
    aws = aws.primary
  }

  name               = "${var.project_name}-${var.environment}-primary"
  vpc_id             = module.vpc_primary.vpc_id
  subnet_ids         = module.vpc_primary.public_subnet_ids
  security_group_ids = [module.security_groups_primary.alb_sg_id]
  
  certificate_arn    = var.ssl_certificate_arn
  
  # Health check configuration
  health_check = {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
    port                = "traffic-port"
    protocol            = "HTTP"
  }
  
  tags = local.common_tags
}

module "alb_secondary" {
  source = "./modules/alb"
  
  providers = {
    aws = aws.secondary
  }

  name               = "${var.project_name}-${var.environment}-secondary"
  vpc_id             = module.vpc_secondary.vpc_id
  subnet_ids         = module.vpc_secondary.public_subnet_ids
  security_group_ids = [module.security_groups_secondary.alb_sg_id]
  
  certificate_arn    = var.ssl_certificate_arn
  
  # Health check configuration
  health_check = {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
    port                = "traffic-port"
    protocol            = "HTTP"
  }
  
  tags = local.common_tags
}

# CloudFront CDN
module "cloudfront" {
  source = "./modules/cloudfront"
  
  providers = {
    aws = aws.primary
  }

  distribution_config = {
    comment             = "${var.project_name} ${var.environment} CDN"
    enabled             = true
    is_ipv6_enabled     = true
    default_root_object = "index.html"
    price_class         = var.cloudfront_price_class
    
    # Origins
    origins = [
      {
        domain_name = module.alb_primary.dns_name
        origin_id   = "primary-alb"
        custom_origin_config = {
          http_port              = 80
          https_port             = 443
          origin_protocol_policy = "https-only"
          origin_ssl_protocols   = ["TLSv1.2"]
        }
      },
      {
        domain_name = module.alb_secondary.dns_name
        origin_id   = "secondary-alb"
        custom_origin_config = {
          http_port              = 80
          https_port             = 443
          origin_protocol_policy = "https-only"
          origin_ssl_protocols   = ["TLSv1.2"]
        }
      }
    ]
    
    # Default cache behavior
    default_cache_behavior = {
      target_origin_id         = "primary-alb"
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods           = ["GET", "HEAD"]
      compress                 = true
      
      forwarded_values = {
        query_string = true
        headers      = ["Authorization", "Host", "CloudFront-Forwarded-Proto"]
        cookies = {
          forward = "all"
        }
      }
      
      min_ttl     = 0
      default_ttl = 3600
      max_ttl     = 86400
    }
    
    # Additional cache behaviors for static assets
    ordered_cache_behaviors = [
      {
        path_pattern           = "/static/*"
        target_origin_id       = "primary-alb"
        viewer_protocol_policy = "redirect-to-https"
        allowed_methods        = ["GET", "HEAD", "OPTIONS"]
        cached_methods         = ["GET", "HEAD"]
        compress               = true
        
        forwarded_values = {
          query_string = false
          headers      = ["Origin", "Access-Control-Request-Headers", "Access-Control-Request-Method"]
          cookies = {
            forward = "none"
          }
        }
        
        min_ttl     = 86400   # 1 day
        default_ttl = 604800  # 1 week
        max_ttl     = 31536000 # 1 year
      }
    ]
    
    # Geographic restrictions
    geo_restriction = {
      restriction_type = "none"
    }
    
    # SSL configuration
    viewer_certificate = {
      acm_certificate_arn      = var.ssl_certificate_arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }
  
  # S3 bucket for static assets
  create_s3_bucket = true
  s3_bucket_name   = "${var.project_name}-${var.environment}-static-assets"
  
  tags = local.common_tags
}

# Route 53 DNS
module "route53" {
  source = "./modules/route53"
  
  providers = {
    aws = aws.primary
  }

  domain_name = var.domain_name
  
  # Health checks and failover configuration
  health_checks = {
    primary = {
      fqdn                            = module.alb_primary.dns_name
      port                            = 443
      type                            = "HTTPS"
      resource_path                   = "/health"
      failure_threshold               = 3
      request_interval                = 30
      cloudwatch_alarm_region         = var.primary_region
      insufficient_data_health_status = "Failure"
    }
    
    secondary = {
      fqdn                            = module.alb_secondary.dns_name
      port                            = 443
      type                            = "HTTPS"
      resource_path                   = "/health"
      failure_threshold               = 3
      request_interval                = 30
      cloudwatch_alarm_region         = var.secondary_region
      insufficient_data_health_status = "Failure"
    }
  }
  
  # DNS records
  records = {
    api = {
      name = "api"
      type = "A"
      set_identifier = "primary"
      failover_routing_policy = {
        type = "PRIMARY"
      }
      health_check_id = "primary"
      alias = {
        name    = module.alb_primary.dns_name
        zone_id = module.alb_primary.zone_id
      }
    }
    
    api_failover = {
      name = "api"
      type = "A"
      set_identifier = "secondary"
      failover_routing_policy = {
        type = "SECONDARY"
      }
      health_check_id = "secondary"
      alias = {
        name    = module.alb_secondary.dns_name
        zone_id = module.alb_secondary.zone_id
      }
    }
    
    www = {
      name = "www"
      type = "A"
      alias = {
        name    = module.cloudfront.domain_name
        zone_id = module.cloudfront.hosted_zone_id
      }
    }
  }
  
  tags = local.common_tags
}

# Monitoring and Logging
module "monitoring" {
  source = "./modules/monitoring"
  
  providers = {
    aws = aws.primary
  }

  project_name = var.project_name
  environment  = var.environment
  
  # CloudWatch configuration
  log_retention_days = var.log_retention_days
  
  # Alarms configuration
  alarms = {
    high_cpu = {
      alarm_name          = "${var.project_name}-${var.environment}-high-cpu"
      comparison_operator = "GreaterThanThreshold"
      evaluation_periods  = "2"
      metric_name         = "CPUUtilization"
      namespace           = "AWS/EKS"
      period              = "300"
      statistic           = "Average"
      threshold           = "80"
      alarm_description   = "This metric monitors EKS CPU utilization"
    }
    
    high_memory = {
      alarm_name          = "${var.project_name}-${var.environment}-high-memory"
      comparison_operator = "GreaterThanThreshold"
      evaluation_periods  = "2"
      metric_name         = "MemoryUtilization"
      namespace           = "AWS/EKS"
      period              = "300"
      statistic           = "Average"
      threshold           = "80"
      alarm_description   = "This metric monitors EKS memory utilization"
    }
  }
  
  # SNS topics for alerting
  sns_topics = {
    alerts = {
      name = "${var.project_name}-${var.environment}-alerts"
      endpoints = var.alert_endpoints
    }
  }
  
  tags = local.common_tags
}

# Secrets Manager
resource "aws_secretsmanager_secret" "app_secrets" {
  provider = aws.primary
  
  name                    = "${var.project_name}/${var.environment}/app-secrets"
  description             = "Application secrets for ${var.project_name}"
  recovery_window_in_days = 7

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "app_secrets" {
  provider = aws.primary
  
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    database_url = module.aurora_primary.endpoint
    redis_url    = module.redis_primary.endpoint
    jwt_secret   = var.jwt_secret
    api_keys = {
      trading_engine = var.trading_engine_api_key
      market_data    = var.market_data_api_key
    }
  })
}

# Parameter Store for configuration
resource "aws_ssm_parameter" "config" {
  provider = aws.primary
  
  for_each = var.ssm_parameters

  name  = "/${var.project_name}/${var.environment}/${each.key}"
  type  = "String"
  value = each.value

  tags = local.common_tags
}