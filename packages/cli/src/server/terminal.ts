import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import * as nodePty from "node-pty";

/**
 * Attach a WebSocket terminal endpoint to the existing HTTP server.
 *
 *   ws://<host>:3002/api/v1/terminal
 *
 * Each connection spawns a PTY running bash (or sh) with the dashboard
 * container's environment — docker socket + blissful-infra CLI on PATH +
 * /blissful-home mounted. Messages from the client are stdin; messages
 * to the client are stdout/stderr. Resize is sent as a JSON control
 * frame: `{ "type": "resize", "cols": N, "rows": N }`.
 *
 * Security model: identical to the rest of the API server. The dashboard
 * is bound to localhost by default; if you publish 3002 broadly, anyone
 * who can reach it gets a shell. No multiplexing — one PTY per socket.
 */
export function attachTerminalWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/api/v1/terminal") return;
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    // Prefer bash if installed, fall back to sh. Alpine ships busybox sh
    // out of the box; we apk-add bash in the dashboard image for nicer UX.
    const shell = process.env.SHELL ?? "/bin/bash";
    const pty = nodePty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.env.BLISSFUL_HOME ?? process.cwd(),
      env: {
        ...process.env,
        TERM: "xterm-256color",
        PS1: "\\[\\e[1;34m\\]blissful\\[\\e[0m\\] \\w \\$ ",
      } as Record<string, string>,
    });

    pty.onData(data => {
      try {
        ws.send(data);
      } catch {
        // Socket closed mid-write; the cleanup below will drop the pty.
      }
    });

    pty.onExit(({ exitCode }) => {
      try {
        ws.send(`\r\n[process exited with code ${exitCode}]\r\n`);
        ws.close();
      } catch { /* ignore */ }
    });

    ws.on("message", (data, isBinary) => {
      const text = isBinary ? data.toString() : data.toString();
      // Control frames: { type: 'resize', cols, rows }. Anything else is stdin.
      if (text.startsWith("{") && text.includes('"type"')) {
        try {
          const msg = JSON.parse(text) as { type?: string; cols?: number; rows?: number };
          if (msg.type === "resize" && msg.cols && msg.rows) {
            pty.resize(msg.cols, msg.rows);
            return;
          }
        } catch { /* fall through, treat as stdin */ }
      }
      pty.write(text);
    });

    ws.on("close", () => {
      try { pty.kill(); } catch { /* already dead */ }
    });
  });
}
