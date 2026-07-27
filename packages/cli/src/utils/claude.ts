import Anthropic from "@anthropic-ai/sdk";
import { execa } from "execa";
import type { ChatMessage } from "./ollama.js";

const CLAUDE_MODELS = [
  { name: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5" },
  { name: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5" },
];

const DEFAULT_MODEL = CLAUDE_MODELS[0].name;

/**
 * Build an SDK client from whichever credentials are present.
 *   - ANTHROPIC_API_KEY  → standard API plan
 *   - ANTHROPIC_AUTH_TOKEN → OAuth bearer (e.g. extracted from a Claude.ai
 *     personal subscription / Claude Code session)
 * Returns null if neither is set; caller may fall back to the CLI subprocess.
 */
function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey && !authToken) return null;
  return new Anthropic({ apiKey, authToken });
}

let cliAvailable: boolean | null = null;

/**
 * Is the Claude Code CLI installed and on PATH? Used as a fallback when no
 * API/OAuth credentials are set — we shell out to `claude -p` which uses
 * the user's already-authenticated Claude.ai subscription session.
 */
export async function checkClaudeCliAvailable(): Promise<boolean> {
  if (cliAvailable !== null) return cliAvailable;
  try {
    await execa("claude", ["--version"], { reject: false, timeout: 3000 });
    cliAvailable = true;
  } catch {
    cliAvailable = false;
  }
  return cliAvailable;
}

/**
 * Check if Claude is available via any path:
 *   1. SDK with API key or OAuth token, OR
 *   2. Claude Code CLI on PATH (personal subscription, no env vars needed)
 */
export async function checkClaudeAvailable(): Promise<boolean> {
  const client = getClient();
  if (client) {
    try {
      await client.models.list({ limit: 1 });
      return true;
    } catch {
      // fall through to CLI check
    }
  }
  return checkClaudeCliAvailable();
}

/**
 * List available Claude models
 */
export function listClaudeModels(): Array<{ name: string; displayName: string }> {
  return CLAUDE_MODELS;
}

/**
 * Select the default Claude model
 */
export function selectClaudeModel(): string {
  return DEFAULT_MODEL;
}

/**
 * Convert our ChatMessage format to Anthropic format.
 * Anthropic requires system message as a separate parameter.
 */
function convertMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemMessages = messages.filter((m) => m.role === "system");
  const conversationMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  return {
    system: systemMessages.length > 0
      ? systemMessages.map((m) => m.content).join("\n\n")
      : undefined,
    messages: conversationMessages,
  };
}

/**
 * Render our ChatMessage[] into a single prompt string for the Claude Code
 * CLI's `-p` mode. The CLI doesn't take a multi-turn message list, so we
 * fake it by prefixing each turn with `User:` / `Assistant:`.
 */
function messagesToCliPrompt(messages: ChatMessage[]): { prompt: string; system: string } {
  const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const turns = messages
    .filter(m => m.role !== "system")
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  return { prompt: turns, system };
}

async function claudeChatViaCli(messages: ChatMessage[]): Promise<string> {
  const { prompt, system } = messagesToCliPrompt(messages);
  const args = ["-p", prompt, "--output-format", "text"];
  if (system) args.push("--append-system-prompt", system);
  // RAG-via-MCP: load /app/.mcp.json explicitly with --mcp-config rather
  // than relying on cwd-discovery (project-scope .mcp.json requires an
  // approval prompt that hangs in -p mode). --allowed-tools whitelists
  // ONLY our MCP server's tools, which pre-approves them without needing
  // the global bypassPermissions mode (Claude Code refuses to bypass
  // permissions when running as root, which the container does). Anything
  // not on the allow list — bash, edit, write — silently no-ops.
  const cwd = process.env.DOCKER_MODE === "true" ? "/app" : undefined;
  if (cwd) {
    args.push("--mcp-config", "/app/.mcp.json");
    args.push("--allowed-tools", "mcp__blissful-infra");
  }
  // `stdin: "ignore"` closes stdin immediately. Without it, `claude -p` waits
  // ~3s for piped input it'll never get and emits a spurious warning. The
  // prompt is already in argv, so there's nothing more to feed it.
  try {
    const { stdout } = await execa("claude", args, {
      stdin: "ignore",
      reject: true,
      cwd,
    });
    return stdout.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Detect the "Not logged in" exit and replace the noisy subprocess error
    // with a one-line hint that tells the user exactly what to do.
    if (/not logged in|please run \/login/i.test(msg)) {
      throw new Error(
        "Claude Code is not logged in inside the dashboard container.\n" +
        "Run on the host: blissful-infra dashboard login",
      );
    }
    throw err;
  }
}

/**
 * Send a chat completion request to Claude. Prefers the SDK (faster,
 * supports streaming). Falls back to the Claude Code CLI when no
 * ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN is set — that lets users on a
 * personal Claude.ai subscription run the agent without an API key by
 * piggybacking on their `claude login` session.
 */
export async function claudeChat(
  model: string,
  messages: ChatMessage[]
): Promise<string> {
  const client = getClient();
  if (client) {
    const { system, messages: anthropicMessages } = convertMessages(messages);
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: anthropicMessages,
    });
    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock?.text ?? "";
  }
  if (await checkClaudeCliAvailable()) {
    return claudeChatViaCli(messages);
  }
  throw new Error("No Claude credentials. Set ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or install Claude Code (`claude login`).");
}

/**
 * Stream a chat completion request to Claude.
 *
 * With SDK credentials: token-by-token streaming via the official API.
 * Without: falls back to the CLI's `-p` mode and yields the whole response
 * as a single chunk — the CLI doesn't expose token-by-token streaming in a
 * stable text format yet, so this is the pragmatic trade-off.
 */
export async function* claudeChatStream(
  model: string,
  messages: ChatMessage[]
): AsyncGenerator<string, void, unknown> {
  const client = getClient();
  if (client) {
    const { system, messages: anthropicMessages } = convertMessages(messages);
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      system,
      messages: anthropicMessages,
    });
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
    return;
  }
  if (await checkClaudeCliAvailable()) {
    yield await claudeChatViaCli(messages);
    return;
  }
  throw new Error("No Claude credentials. Set ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or install Claude Code (`claude login`).");
}
