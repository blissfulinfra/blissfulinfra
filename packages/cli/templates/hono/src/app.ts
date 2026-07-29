import { Hono } from "hono";
import { logger } from "hono/logger";

/**
 * The application, defined against Web-standard Request/Response only.
 *
 * Nothing in this file may import from `node:*`. That constraint is what lets
 * the same code run under Node in a container (src/server.ts) and on
 * Cloudflare Workers (src/worker.ts).
 */

export interface Env {
  SERVICE_NAME?: string;
{{#IF_POSTGRES}}
  DATABASE_URL?: string;
{{/IF_POSTGRES}}
}

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.use("*", logger());

  // Probed by the Argo Rollout and by Docker's healthcheck.
  app.get("/health", c => c.json({ status: "UP", service: "{{PROJECT_NAME}}" }));

  app.get("/", c => c.json({
    service: "{{PROJECT_NAME}}",
    message: "Hello from blissful-infra",
  }));

  app.get("/api/hello", c => {
    const name = c.req.query("name") ?? "world";
    return c.json({ greeting: `Hello, ${name}` });
  });

  return app;
}

export const app = createApp();
export default app;
