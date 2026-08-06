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

{{#IF_POSTGRES}}
  // Chat message persistence (demo frontend)
  // In production, integrate with your real database
  const chatMessages: Array<{ id: number; author: string; body: string; createdAt: string; sessionId: string }> = [];
  let messageId = 1;

  app.get("/api/messages", c => {
    const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
    const recent = chatMessages.slice(-limit);
    return c.json({ messages: recent, total: recent.length });
  });

  app.post("/api/messages", async c => {
    try {
      const body = await c.req.json() as { author: string; body: string; sessionId?: string };
      const msg = {
        id: messageId++,
        author: body.author || "Anonymous",
        body: body.body,
        sessionId: body.sessionId || "",
        createdAt: new Date().toISOString(),
      };
      chatMessages.push(msg);
      return c.json(msg);
    } catch (e) {
      return c.json({ error: "Failed to save message" }, 400);
    }
  });
{{/IF_POSTGRES}}

  return app;
}

export const app = createApp();
export default app;
