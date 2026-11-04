# Multi-stage production build for LinkTest Backend
FROM node:20-alpine AS dependencies
WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8081

# Create non-root system group and user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 linktest && \
    chown -R linktest:nodejs /app

# Copy production node_modules from dependencies stage
COPY --from=dependencies --chown=linktest:nodejs /app/node_modules ./node_modules

# Copy application source code with non-root ownership
COPY --chown=linktest:nodejs . .

# Switch to non-root execution
USER linktest

# Expose backend service port
EXPOSE 8081

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8081/api/health || exit 1

# Start production server
CMD ["node", "src/server.js"]
