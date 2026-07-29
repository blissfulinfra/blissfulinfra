# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Production stage — only runtime deps, no toolchain
FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Matches the Rollout's readiness probe and the compose healthcheck.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["node", "dist/server.js"]
