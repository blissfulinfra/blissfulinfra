import { serve } from "@hono/node-server";
import app from "./app.js";

/**
 * Node entry point — used by the container image for the compose and
 * kubernetes runtimes. Port 8080 matches the Rollout's containerPort.
 */
const port = Number(process.env.PORT ?? 8080);

serve({ fetch: app.fetch, port }, info => {
  console.log(`{{PROJECT_NAME}} listening on :${info.port}`);
});
