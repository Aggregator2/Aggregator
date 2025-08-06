# CI/CD Pipeline Deployment Guide
**Version**: 1.0  
**Last Updated**: July 12, 2025  
**Target**: Production-Ready CI/CD Pipeline

---

## 🎯 Overview

This guide provides comprehensive documentation for the enterprise-grade CI/CD pipeline implemented for the SettlementQueue project. The pipeline includes automated testing, security scanning, smart contract testing, performance regression testing, and advanced deployment strategies with rollback capabilities.

## 🏗️ Pipeline Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Code Commit   │───►│   CI Pipeline   │───►│   CD Pipeline   │
│   (Git Push)    │    │   (Tests/Scan)  │    │  (Deploy/Test)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Automated     │    │   Security      │    │   Blue-Green    │
│   Testing       │    │   Scanning      │    │   Deployment    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Performance   │    │   Contract      │    │   Rollback      │
│   Testing       │    │   Testing       │    │   Procedures    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📋 Pipeline Components

### **1. Continuous Integration (CI)**
- **File**: `.github/workflows/ci.yml`
- **Triggers**: Push to main/develop/feature branches, PRs
- **Features**:
  - Code quality and linting
  - Unit and integration tests
  - Smart contract testing with Foundry
  - Multi-node version testing (16, 18, 20)
  - Test coverage reporting

### **2. Security Scanning**
- **File**: `.github/workflows/security.yml`
- **Triggers**: Push, PR, scheduled daily
- **Features**:
  - Dependency vulnerability scanning (Snyk)
  - Static Application Security Testing (SAST)
  - Container security scanning
  - Smart contract security analysis
  - License compliance checking

### **3. Automated Dependency Updates**
- **File**: `.github/dependabot.yml`
- **Features**:
  - Weekly dependency updates
  - Security patch automation
  - Grouped package updates
  - Multiple ecosystem support

### **4. Staging Deployment**
- **File**: `.github/workflows/deploy-staging.yml`
- **Triggers**: Push to develop branch
- **Features**:
  - Automated database migrations
  - Application deployment to EKS
  - Post-deployment testing
  - Health check validation

### **5. Production Deployment**
- **File**: `.github/workflows/deploy-production.yml`
- **Triggers**: Push to main branch, manual dispatch
- **Features**:
  - Blue-green deployment strategy
  - Manual approval gates
  - Production readiness checks
  - Zero-downtime deployments

### **6. Emergency Rollback**
- **File**: `.github/workflows/rollback.yml`
- **Triggers**: Manual dispatch only
- **Features**:
  - Immediate and graceful rollback options
  - Database rollback capabilities
  - Blue-green slot switching
  - Automated validation

---

## 🚀 Setup Instructions

### **Prerequisites**

1. **GitHub Repository Secrets**:
   ```
   # AWS Credentials
   AWS_ACCESS_KEY_ID
   AWS_SECRET_ACCESS_KEY
   AWS_ACCESS_KEY_ID_PROD
   AWS_SECRET_ACCESS_KEY_PROD
   
   # Container Registry
   GITHUB_TOKEN (auto-provided)
   
   # Security Scanning
   SNYK_TOKEN
   SEMGREP_APP_TOKEN
   CODECOV_TOKEN
   
   # Notifications
   SLACK_WEBHOOK_URL
   TEAMS_WEBHOOK_URL
   SECURITY_SLACK_WEBHOOK
   ```

2. **AWS Infrastructure**:
   - EKS clusters for staging and production
   - RDS databases with backup/restore capabilities
   - S3 buckets for artifacts and backups
   - Secrets Manager for database credentials

3. **Kubernetes Setup**:
   - Namespaces: `staging`, `production`
   - Service accounts with appropriate RBAC
   - Ingress controllers configured

### **Installation Steps**

#### **Step 1: Configure Repository Settings**

```bash
# Enable GitHub Actions
# Go to Settings > Actions > General
# - Allow all actions and reusable workflows
# - Allow actions created by GitHub
# - Enable workflow permissions: Read and write permissions

# Add required secrets
gh secret set AWS_ACCESS_KEY_ID --body="your-aws-access-key"
gh secret set AWS_SECRET_ACCESS_KEY --body="your-aws-secret-key"
gh secret set SNYK_TOKEN --body="your-snyk-token"
# ... add all other secrets
```

#### **Step 2: Set Up Package.json Scripts**

```json
{
  "scripts": {
    "lint": "eslint src/ --ext .js,.ts,.tsx",
    "format:check": "prettier --check src/",
    "type-check": "tsc --noEmit",
    "test": "jest",
    "test:unit": "jest --testPathPattern=unit",
    "test:integration": "jest --testPathPattern=integration",
    "test:contracts": "cd contracts && forge test",
    "test:smoke": "jest --testPathPattern=smoke",
    "test:smoke:production": "jest --testPathPattern=smoke --config=jest.production.config.js",
    "test:e2e": "cypress run",
    "test:performance": "artillery run test/performance/load-test.yml",
    "test:performance:quick": "artillery quick --count 100 --num 10",
    "build": "next build",
    "compile": "hardhat compile",
    "migrate:test": "npm run db:migrate -- --env=test",
    "migrate:up": "npm run db:migrate -- --direction=up",
    "migrate:rollback": "npm run db:migrate -- --direction=down",
    "db:health-check": "node scripts/db-health-check.js",
    "db:backup": "node scripts/db-backup.js",
    "db:migrate": "node scripts/db-migrate.js"
  }
}
```

#### **Step 3: Create Kubernetes Manifests**

Create the following directory structure:
```
k8s/
├── staging/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── configmap.yaml
│   ├── secrets.yaml
│   └── ingress.yaml
└── production/
    ├── deployment-blue.yaml
    ├── deployment-green.yaml
    ├── service-active.yaml
    ├── service-blue.yaml
    ├── service-green.yaml
    └── ingress.yaml
```

**Example Staging Deployment**:
```yaml
# k8s/staging/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
  namespace: staging
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api-gateway
  template:
    metadata:
      labels:
        app: api-gateway
    spec:
      containers:
      - name: api-gateway
        image: IMAGE_PLACEHOLDER
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "staging"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: database-secret
              key: url
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "250m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

#### **Step 4: Performance Testing Setup**

```bash
# Install Artillery globally for performance testing
npm install -g artillery@latest

# Create performance test directory
mkdir -p test/performance

# Add performance test configuration (already created in load-test.yml)
# Add baseline configuration (already created in baseline.json)
```

#### **Step 5: Smart Contract Testing Setup**

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Initialize Foundry project (if not already done)
cd contracts
forge init --force

# Create foundry.toml
cat > foundry.toml << EOF
[profile.default]
src = "."
out = "out"
libs = ["lib"]
test = "test"
cache_path = "cache"
optimizer = true
optimizer_runs = 200
via_ir = false

[profile.ci]
fuzz = { runs = 10000 }
invariant = { runs = 1000 }
EOF
```

---

## 🔧 Configuration Options

### **CI Pipeline Configuration**

The CI pipeline can be customized by modifying environment variables in `.github/workflows/ci.yml`:

```yaml
env:
  NODE_VERSION: '18'          # Node.js version
  REGISTRY: ghcr.io          # Container registry
  IMAGE_NAME: ${{ github.repository }}
```

### **Security Scanning Configuration**

Customize security scanning in `.github/workflows/security.yml`:

```yaml
# Adjust scan schedules
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC

# Configure Semgrep rules
config: >-
  p/security-audit
  p/secrets
  p/owasp-top-ten
  p/nodejs
```

### **Deployment Strategy Configuration**

Configure deployment strategies in `.github/workflows/deploy-production.yml`:

```yaml
# Available strategies
deployment_strategy:
  - blue-green    # Zero-downtime blue-green deployment
  - canary       # Gradual traffic shifting
  - rolling      # Rolling update deployment
```

### **Performance Testing Configuration**

Customize performance tests in `test/performance/load-test.yml`:

```yaml
config:
  phases:
    - duration: 60
      arrivalRate: 5
      name: "Warm-up"
    - duration: 300
      arrivalRate: 50
      name: "Sustained load"
  
  ensure:
    thresholds:
      - http.response_time.p95: 500
      - http.codes.200: 95
```

---

## 📊 Monitoring and Metrics

### **Pipeline Metrics**

The CI/CD pipeline automatically collects and reports:

- **Build Success Rate**: Percentage of successful builds
- **Test Coverage**: Code coverage across unit/integration tests
- **Security Scan Results**: Vulnerability counts and severity
- **Performance Metrics**: Response times and throughput
- **Deployment Frequency**: Number of deployments per day/week
- **Lead Time**: Time from commit to production
- **Mean Time to Recovery (MTTR)**: Average time to recover from failures

### **Monitoring Dashboards**

Access monitoring through:

1. **GitHub Actions**: 
   - Workflow runs and status
   - Artifact downloads
   - Test results and coverage

2. **Security Dashboard**:
   - GitHub Security tab for SARIF results
   - Dependabot alerts and PRs
   - Secret scanning alerts

3. **Performance Monitoring**:
   - Artillery reports in workflow artifacts
   - Performance regression analysis
   - Baseline comparisons

### **Alerting**

Notifications are sent via:

- **Slack**: Build failures, deployment status, security alerts
- **GitHub Issues**: Automated issue creation for failures
- **Email**: Dependabot security updates
- **Teams**: Critical failure notifications

---

## 🚨 Troubleshooting

### **Common Issues**

#### **1. Build Failures**

```bash
# Check logs
gh run list --limit 5
gh run view [RUN_ID]

# Debug locally
npm ci
npm run lint
npm run test
npm run build
```

#### **2. Test Failures**

```bash
# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:contracts

# Check test coverage
npm run test -- --coverage
```

#### **3. Security Scan Failures**

```bash
# Run security scans locally
npm audit --audit-level=high
npx snyk test
docker run --rm -v $(pwd):/app semgrep/semgrep:latest --config=auto /app
```

#### **4. Deployment Failures**

```bash
# Check Kubernetes status
kubectl get pods -n staging
kubectl describe deployment api-gateway -n staging
kubectl logs deployment/api-gateway -n staging

# Check AWS EKS
aws eks describe-cluster --name settlement-queue-staging
```

#### **5. Performance Test Failures**

```bash
# Run performance tests locally
npm install -g artillery
artillery run test/performance/load-test.yml

# Check performance regression
node scripts/check-performance-regression.js \
  --current performance-report.json \
  --baseline test/performance/baseline.json
```

### **Debug Commands**

```bash
# View workflow logs
gh run list --workflow=ci.yml
gh run view --log

# Check repository secrets
gh secret list

# Test Kubernetes connectivity
kubectl cluster-info
kubectl get nodes

# Verify AWS credentials
aws sts get-caller-identity
aws eks list-clusters
```

---

## 🔒 Security Best Practices

### **1. Secret Management**

- Use GitHub Secrets for all sensitive data
- Rotate secrets regularly (quarterly)
- Use different credentials for staging/production
- Enable secret scanning alerts

### **2. Access Control**

- Require branch protection rules
- Mandate PR reviews for main/develop branches
- Use CODEOWNERS file for critical components
- Enable required status checks

### **3. Security Scanning**

- Daily automated security scans
- Fail builds on high/critical vulnerabilities
- Monitor dependency vulnerabilities
- Regular container image scanning

### **4. Deployment Security**

- Manual approval for production deployments
- Environment-specific secrets and configurations
- Network policies in Kubernetes
- Resource limits and security contexts

---

## 📈 Performance Optimization

### **1. Build Optimization**

- Use dependency caching
- Parallel job execution
- Artifact reuse between jobs
- Optimized Docker builds with multi-stage

### **2. Test Optimization**

- Test parallelization
- Test result caching
- Selective test execution
- Performance baseline tracking

### **3. Deployment Optimization**

- Blue-green deployments for zero downtime
- Health check optimization
- Resource scaling strategies
- Connection pooling

---

## 📋 Maintenance Tasks

### **Daily**
- [ ] Monitor build success rates
- [ ] Review security scan results
- [ ] Check dependency updates
- [ ] Verify deployment health

### **Weekly**
- [ ] Review and merge Dependabot PRs
- [ ] Update performance baselines
- [ ] Review failed deployments
- [ ] Update documentation

### **Monthly**
- [ ] Rotate secrets and credentials
- [ ] Review and update security policies
- [ ] Performance optimization review
- [ ] Disaster recovery testing

### **Quarterly**
- [ ] Full security audit
- [ ] Infrastructure capacity planning
- [ ] Tool and dependency major updates
- [ ] Process improvement review

---

## 🎯 Next Steps

1. **Deploy the Pipeline**:
   - Set up all required secrets
   - Configure AWS infrastructure
   - Deploy Kubernetes manifests
   - Test all workflows

2. **Team Training**:
   - Pipeline usage training
   - Emergency procedures training
   - Security best practices
   - Troubleshooting guidelines

3. **Monitoring Setup**:
   - Configure alerting channels
   - Set up dashboard access
   - Define SLA monitoring
   - Establish on-call procedures

4. **Continuous Improvement**:
   - Regular pipeline reviews
   - Performance optimization
   - Security enhancement
   - Process automation

---

**Support**: For pipeline issues, contact the DevOps team or create an issue in the repository with the `ci/cd` label.

**Documentation**: This guide should be updated whenever pipeline changes are made to ensure accuracy and completeness.