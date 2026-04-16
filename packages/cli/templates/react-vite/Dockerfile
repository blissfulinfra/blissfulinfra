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

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
