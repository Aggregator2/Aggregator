#!/bin/bash

# DEX Platform Authentication Services Deployment Script
# This script deploys the complete authentication infrastructure to EKS

set -euo pipefail

# Configuration
CLUSTER_NAME=${CLUSTER_NAME:-"dex-platform-primary"}
REGION=${REGION:-"us-east-1"}
NAMESPACE=${NAMESPACE:-"dex-platform"}
MONITORING_NAMESPACE=${MONITORING_NAMESPACE:-"dex-monitoring"}
KUSTOMIZE_DIR=${KUSTOMIZE_DIR:-"./"}
TERRAFORM_DIR=${TERRAFORM_DIR:-"../terraform"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Error handling
cleanup() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        log_error "Deployment failed with exit code $exit_code"
        log_info "Check the logs above for details"
    fi
    exit $exit_code
}

trap cleanup EXIT

# Prerequisite checks
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check required tools
    local required_tools=("kubectl" "aws" "kustomize" "terraform")
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            log_error "$tool is required but not installed"
            exit 1
        fi
    done
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured"
        exit 1
    fi
    
    # Check terraform state
    if [ -d "$TERRAFORM_DIR" ]; then
        pushd "$TERRAFORM_DIR" > /dev/null
        if ! terraform show &> /dev/null; then
            log_error "Terraform infrastructure not deployed. Please run terraform apply first."
            exit 1
        fi
        popd > /dev/null
    fi
    
    log_info "Prerequisites check passed"
}

# Update kubeconfig
update_kubeconfig() {
    log_info "Updating kubeconfig for cluster: $CLUSTER_NAME"
    aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER_NAME"
    
    # Verify connection
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Failed to connect to Kubernetes cluster"
        exit 1
    fi
    
    log_info "Successfully connected to cluster"
}

# Deploy namespaces first
deploy_namespaces() {
    log_info "Creating namespaces..."
    kubectl apply -f namespace.yaml
    
    # Wait for namespaces to be ready
    kubectl wait --for=condition=Ready namespace/$NAMESPACE --timeout=60s
    kubectl wait --for=condition=Ready namespace/$MONITORING_NAMESPACE --timeout=60s
    
    log_info "Namespaces created successfully"
}

# Deploy RBAC
deploy_rbac() {
    log_info "Deploying RBAC configurations..."
    kubectl apply -f rbac.yaml
    
    # Verify service account creation
    kubectl wait --for=condition=Ready serviceaccount/auth-service-account -n $NAMESPACE --timeout=60s
    
    log_info "RBAC deployed successfully"
}

# Deploy secrets and configmaps
deploy_secrets() {
    log_info "Deploying secrets and configuration..."
    
    # Apply secrets (should be populated from external secret manager in production)
    kubectl apply -f secrets.yaml
    
    # Generate additional secrets if needed
    if ! kubectl get secret dex-platform-tls -n $NAMESPACE &> /dev/null; then
        log_warn "TLS secret not found. Creating self-signed certificate for development..."
        create_self_signed_cert
    fi
    
    log_info "Secrets and configuration deployed"
}

# Create self-signed certificate for development
create_self_signed_cert() {
    local cert_dir="/tmp/dex-certs"
    mkdir -p "$cert_dir"
    
    # Generate private key
    openssl genrsa -out "$cert_dir/tls.key" 2048
    
    # Generate certificate
    openssl req -new -x509 -key "$cert_dir/tls.key" -out "$cert_dir/tls.crt" -days 365 -subj "/CN=api.dex-platform.com"
    
    # Create Kubernetes secret
    kubectl create secret tls dex-platform-tls \
        --cert="$cert_dir/tls.crt" \
        --key="$cert_dir/tls.key" \
        -n $NAMESPACE
    
    # Cleanup
    rm -rf "$cert_dir"
    
    log_info "Self-signed certificate created"
}

# Deploy authentication services
deploy_auth_services() {
    log_info "Deploying authentication services..."
    
    # Deploy services in order
    local services=("authentication-service" "session-manager-service" "wallet-auth-service" "rbac-service")
    
    for service in "${services[@]}"; do
        log_info "Deploying $service..."
        kubectl apply -f "$service.yaml"
        
        # Wait for deployment to be ready
        kubectl wait --for=condition=Available deployment/$service -n $NAMESPACE --timeout=300s
        
        log_info "$service deployed successfully"
    done
}

# Deploy ingress
deploy_ingress() {
    log_info "Deploying ingress controller..."
    
    # Check if AWS Load Balancer Controller is installed
    if ! kubectl get deployment aws-load-balancer-controller -n kube-system &> /dev/null; then
        log_warn "AWS Load Balancer Controller not found. Installing..."
        install_alb_controller
    fi
    
    kubectl apply -f ingress.yaml
    
    # Wait for ingress to get an address
    log_info "Waiting for load balancer to be provisioned..."
    kubectl wait --for=condition=Ready ingress/dex-platform-ingress -n $NAMESPACE --timeout=600s
    
    # Get the load balancer address
    local lb_address
    lb_address=$(kubectl get ingress dex-platform-ingress -n $NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
    
    if [ -n "$lb_address" ]; then
        log_info "Load balancer provisioned: $lb_address"
    else
        log_warn "Load balancer address not yet available"
    fi
}

# Install AWS Load Balancer Controller
install_alb_controller() {
    log_info "Installing AWS Load Balancer Controller..."
    
    # This is a simplified installation - in production, use Helm or EKS add-ons
    kubectl apply -k "github.com/aws/eks-charts/stable/aws-load-balancer-controller//crds?ref=master"
    
    # Note: In production, you should use Helm to install the controller with proper configuration
    log_warn "AWS Load Balancer Controller installation initiated. Please complete the setup manually."
}

# Deploy monitoring
deploy_monitoring() {
    log_info "Deploying monitoring stack..."
    kubectl apply -f monitoring.yaml
    
    # Wait for Prometheus to be ready
    kubectl wait --for=condition=Available deployment/prometheus -n $MONITORING_NAMESPACE --timeout=300s
    
    log_info "Monitoring stack deployed successfully"
}

# Deploy network policies
deploy_network_policies() {
    log_info "Deploying network policies..."
    kubectl apply -f network-policies.yaml
    
    log_info "Network policies deployed"
}

# Deploy pod security policies
deploy_security_policies() {
    log_info "Deploying security policies..."
    kubectl apply -f pod-security-policies.yaml
    
    log_info "Security policies deployed"
}

# Verify deployment
verify_deployment() {
    log_info "Verifying deployment..."
    
    # Check all pods are running
    local services=("authentication-service" "session-manager-service" "wallet-auth-service" "rbac-service")
    
    for service in "${services[@]}"; do
        local replicas
        replicas=$(kubectl get deployment $service -n $NAMESPACE -o jsonpath='{.status.readyReplicas}')
        local desired
        desired=$(kubectl get deployment $service -n $NAMESPACE -o jsonpath='{.spec.replicas}')
        
        if [ "$replicas" = "$desired" ]; then
            log_info "$service: $replicas/$desired replicas ready ✓"
        else
            log_error "$service: $replicas/$desired replicas ready ✗"
            return 1
        fi
    done
    
    # Check services are accessible
    log_info "Checking service endpoints..."
    kubectl get services -n $NAMESPACE
    
    # Check ingress
    kubectl get ingress -n $NAMESPACE
    
    log_info "Deployment verification completed successfully"
}

# Print deployment summary
print_summary() {
    log_info "Deployment Summary"
    echo "=================="
    echo "Cluster: $CLUSTER_NAME"
    echo "Region: $REGION"
    echo "Namespace: $NAMESPACE"
    echo "Monitoring Namespace: $MONITORING_NAMESPACE"
    echo ""
    
    log_info "Deployed Services:"
    kubectl get deployments -n $NAMESPACE -o wide
    echo ""
    
    log_info "Service Endpoints:"
    kubectl get services -n $NAMESPACE
    echo ""
    
    log_info "Ingress Information:"
    kubectl get ingress -n $NAMESPACE
    echo ""
    
    local lb_address
    lb_address=$(kubectl get ingress dex-platform-ingress -n $NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "Not available")
    
    if [ "$lb_address" != "Not available" ]; then
        echo "API Endpoint: https://$lb_address"
        echo "Health Check: https://$lb_address/health"
    fi
    
    log_info "To check pod status: kubectl get pods -n $NAMESPACE"
    log_info "To check logs: kubectl logs -n $NAMESPACE deployment/<service-name>"
    log_info "To port-forward for testing: kubectl port-forward -n $NAMESPACE service/<service-name> 8080:80"
}

# Main deployment function
main() {
    log_info "Starting DEX Platform Authentication Services Deployment"
    log_info "Cluster: $CLUSTER_NAME, Region: $REGION"
    
    check_prerequisites
    update_kubeconfig
    deploy_namespaces
    deploy_rbac
    deploy_secrets
    deploy_auth_services
    deploy_ingress
    deploy_monitoring
    deploy_network_policies
    deploy_security_policies
    verify_deployment
    print_summary
    
    log_info "Deployment completed successfully! 🚀"
}

# Script usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Deploy DEX Platform Authentication Services to EKS

OPTIONS:
    -c, --cluster       EKS cluster name (default: dex-platform-primary)
    -r, --region        AWS region (default: us-east-1)
    -n, --namespace     Kubernetes namespace (default: dex-platform)
    -m, --monitoring    Monitoring namespace (default: dex-monitoring)
    -d, --dir           Kustomize directory (default: ./)
    -t, --terraform     Terraform directory (default: ../terraform)
    -h, --help          Show this help message

EXAMPLES:
    $0                                  # Deploy with defaults
    $0 -c my-cluster -r us-west-2      # Deploy to specific cluster/region
    $0 --namespace prod-auth            # Deploy to custom namespace

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -c|--cluster)
            CLUSTER_NAME="$2"
            shift 2
            ;;
        -r|--region)
            REGION="$2"
            shift 2
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -m|--monitoring)
            MONITORING_NAMESPACE="$2"
            shift 2
            ;;
        -d|--dir)
            KUSTOMIZE_DIR="$2"
            shift 2
            ;;
        -t|--terraform)
            TERRAFORM_DIR="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Change to kustomize directory
cd "$KUSTOMIZE_DIR"

# Run main deployment
main