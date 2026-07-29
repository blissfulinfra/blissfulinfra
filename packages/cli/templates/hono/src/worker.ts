import app from "./app.js";

/**
 * Cloudflare Workers entry point — used by `blissful-infra deploy
 * {{PROJECT_NAME}} --target cloudflare`. A Worker's default export is an
 * object with a fetch handler, which is exactly Hono's shape.
 */
export default app;
