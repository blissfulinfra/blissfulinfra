---
title: React + Vite Template
description: React + Vite + TypeScript + TailwindCSS frontend with WebSocket integration.
---

The `react-vite` template generates a React + Vite frontend application. It is the default frontend when you run `blissful-infra start` without specifying `--frontend`.

## Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| React | 18+ | UI library |
| Vite | 5+ | Build tool and dev server |
| TypeScript | 5+ | Type-safe JavaScript |
| TailwindCSS | 3+ | Utility-first CSS framework |
| nginx | alpine | Production static file server |

## What gets generated

```
frontend/
├── src/
│   ├── main.tsx                  # React root, StrictMode
│   ├── App.tsx                   # Root component with router/layout
│   ├── components/
│   │   └── ChatWindow.tsx        # WebSocket chat component
│   ├── hooks/
│   │   └── useWebSocket.ts       # WebSocket connection hook
│   └── index.css                 # TailwindCSS directives
├── public/
│   └── vite.svg
├── index.html                    # HTML entry point
├── vite.config.ts                # Vite config with proxy setup
├── tailwind.config.js            # TailwindCSS configuration
├── tsconfig.json                 # TypeScript strict config
├── package.json                  # Dependencies and scripts
└── Dockerfile                    # Multi-stage: build + nginx
```

## The example application

The generated frontend is a chat UI that connects to the backend via WebSocket. It demonstrates the full real-time stack out of the box.

### ChatWindow component

`src/components/ChatWindow.tsx` is the main UI component. It:

- Connects to `ws://<host>/ws/chat` through the nginx reverse proxy
- Sends messages on form submit
- Receives messages via the WebSocket subscription
- Renders a scrollable message list with sender name and timestamp
- Reconnects automatically if the connection drops

### WebSocket hook

`src/hooks/useWebSocket.ts` wraps the browser WebSocket API:

```typescript
const { messages, sendMessage, connected } = useWebSocket('/ws/chat');
```

The hook handles connection state, message queuing during reconnect, and cleanup on unmount.

## Vite configuration

`vite.config.ts` sets up a development proxy so API calls to `/api/` and WebSocket connections to `/ws/` are forwarded to the backend during local development:

```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
```

In production (Docker), nginx handles the same routing via `nginx.conf`.

## Docker image

The Dockerfile uses a two-stage build:

1. **Build stage** — Node.js image, runs `npm ci && npm run build`, produces a `dist/` directory
2. **Serve stage** — nginx alpine image, copies `dist/` to `/usr/share/nginx/html`

The result is a minimal image (typically 25–40 MB) containing only nginx and the built static files.

## nginx integration

The frontend container is placed behind the project-level nginx reverse proxy. `nginx.conf` (in the project root) routes:

- `GET /` and all non-API paths → frontend container on port 80
- `POST/GET /api/*` → backend container on port 8080
- WebSocket `Upgrade` requests to `/ws/*` → backend container on port 8080

This means the frontend and backend are available on the same origin (`http://localhost:80`) in addition to their direct ports.

## TailwindCSS

The template ships with TailwindCSS 3 configured with:

- `content` pointing at `./src/**/*.{ts,tsx}`
- No custom theme overrides — add your own in `tailwind.config.js`
- `@tailwind base`, `@tailwind components`, `@tailwind utilities` in `index.css`

## Development workflow

### Standard dev server

```bash
cd my-app/frontend
npm install
npm run dev
# Vite dev server starts at http://localhost:5173
```

In this mode, Vite proxies API requests to the backend at `localhost:8080`. Both can run simultaneously.

### Template dev mode (via blissful-infra)

For the most seamless experience with full Vite HMR:

```bash
# From repo root — syncs template edits live into the running project
blissful-infra dev --templates my-app
```

This stops the Docker frontend container, starts Vite natively on port 3000, and patches nginx to route to the native dev server. Changes to template source files in `packages/cli/templates/react-vite/src/` are immediately synced to `my-app/frontend/src/` and picked up by Vite HMR.

### Building for production

```bash
npm run build
# Output in dist/
```

The same build runs inside the Docker multi-stage build when you run `docker compose up --build`.

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `vite` | Start dev server with HMR |
| `build` | `tsc && vite build` | Type-check and build for production |
| `preview` | `vite preview` | Preview production build locally |
| `lint` | `eslint .` | Run ESLint |
