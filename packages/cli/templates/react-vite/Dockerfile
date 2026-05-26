# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source separately so node_modules layer is cached
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json* tsconfig.node.json* ./
COPY postcss.config.js tailwind.config.js* ./
COPY public ./public
COPY src ./src

RUN npm run build

# Production stage
FROM nginx:alpine

RUN apk add --no-cache curl

# Templates in /etc/nginx/templates/ get envsubst'd at container start
# (the nginx image runs /docker-entrypoint.d/20-envsubst-on-templates.sh).
# BACKEND_HOST and BACKEND_PORT are injected by service-compose so the
# frontend points at the actual backend service inside the project network.
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
