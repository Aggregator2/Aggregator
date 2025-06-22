# Multi-stage Dockerfile for Meta Aggregator API
# Optimized for production deployment

# Stage 1: Build stage
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install ALL dependencies (including dev dependencies for build)
RUN npm ci && npm cache clean --force

# Copy application code for building
COPY . .

# Build the Next.js application
RUN npm run build

# Debug: List contents after build
RUN ls -la .next/ || echo "No .next directory found"

# Stage 2: Production stage  
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init curl

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S metaaggregator -u 1001

# Set working directory
WORKDIR /app

# Copy only production dependencies (install them fresh)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Copy configuration files
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/package*.json ./

# Copy other necessary runtime files (not source files that might overwrite built files)
COPY --from=builder /app/contracts ./contracts
COPY --from=builder /app/scripts ./scripts

# Create logs directory with proper permissions
RUN mkdir -p logs && \
    chown -R metaaggregator:nodejs logs && \
    chmod 755 logs

# Set proper ownership
RUN chown -R metaaggregator:nodejs /app

# Switch to non-root user
USER metaaggregator

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Expose API port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Labels for metadata
LABEL org.opencontainers.image.title="Meta Aggregator API"
LABEL org.opencontainers.image.description="Meta Aggregator 2.0 API service"
LABEL org.opencontainers.image.vendor="Meta Aggregator 2.0"
LABEL org.opencontainers.image.version="1.0.0"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command
CMD ["npm", "start"]
