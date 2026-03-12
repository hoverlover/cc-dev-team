# ==============================================================================
# cc-dev-team Docker Image
# Multi-stage build for cloud deployment on Fly.io Machines
# ==============================================================================

# Stage 1: Builder — install production dependencies
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production --ignore-scripts

COPY broker/ broker/
COPY pi/ pi/
COPY agents/ agents/
COPY docs/ docs/
COPY tools/ tools/
COPY hooks/ hooks/
COPY scripts/ scripts/
COPY AGENTS.md ./

# Stage 2: Runtime
FROM node:22-slim AS runtime

# Install git and curl (for health checks and agent repo operations)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app
WORKDIR /app

# Create data directory for volume mount
RUN mkdir -p /data && chown node:node /data

# Switch to non-root user
USER node

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:${PORT:-8080}/health || exit 1

EXPOSE 8080

ENV CC_MODE=cloud
ENV PORT=8080
ENV DATA_DIR=/data
ENV NODE_ENV=production

CMD ["node", "broker/server.js"]
