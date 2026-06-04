import type { ChatMessage } from "./ollama.js";
import {
  checkOllamaRunning,
  listModels as listOllamaModels,
  selectModel as selectOllamaModel,
  chat as ollamaChat,
  chatStream as ollamaChatStream,
} from "./ollama.js";
import {
  checkClaudeAvailable,
  listClaudeModels,
  selectClaudeModel,
  claudeChat,
  claudeChatStream,
} from "./claude.js";

export type AIProvider = "claude" | "ollama";

export interface AIModelInfo {
  provider: AIProvider;
  model: string;
}

/**
 * Determine the best available AI provider.
 *
 * "Available" for Claude now means any of: ANTHROPIC_API_KEY,
 * ANTHROPIC_AUTH_TOKEN (OAuth), or the `claude` CLI on PATH (uses the
 * user's authenticated Claude.ai session). Auto-select still prefers
 * Claude over Ollama.
 */
export async function getProvider(
  preferred?: AIProvider
): Promise<AIProvider | null> {
  if (preferred === "claude") {
    return (await checkClaudeAvailable()) ? "claude" : null;
  }
  if (preferred === "ollama") {
    return (await checkOllamaRunning()) ? "ollama" : null;
  }

  if (await checkClaudeAvailable()) return "claude";
  if (await checkOllamaRunning()) return "ollama";
  return null;
}

/**
 * Get provider and model info, optionally with a requested model override.
 */
export async function getModelInfo(
  requestedModel?: string,
  preferredProvider?: AIProvider
): Promise<AIModelInfo | null> {
  const provider = await getProvider(preferredProvider);
  if (!provider) return null;

  if (requestedModel) {
    return { provider, model: requestedModel };
  }

  if (provider === "claude") {
    return { provider, model: selectClaudeModel() };
  }

  const model = await selectOllamaModel();
  if (!model) return null;
  return { provider, model };
}

/**
 * Send a chat completion request using the specified provider.
 */
export async function aiChat(
  provider: AIProvider,
  model: string,
  messages: ChatMessage[]
): Promise<string> {
  if (provider === "claude") {
    return claudeChat(model, messages);
  }
  return ollamaChat(model, messages);
}

/**
 * Stream a chat completion request using the specified provider.
 */
export async function* aiChatStream(
  provider: AIProvider,
  model: string,
  messages: ChatMessage[]
): AsyncGenerator<string, void, unknown> {
  if (provider === "claude") {
    yield* claudeChatStream(model, messages);
  } else {
    yield* ollamaChatStream(model, messages);
  }
}

/**
 * List all models across all available providers.
 */
export async function listAllModels(): Promise<
  Array<{ name: string; provider: AIProvider; displayName?: string }>
> {
  const models: Array<{
    name: string;
    provider: AIProvider;
    displayName?: string;
  }> = [];

  // Add Claude models if any Claude path is available (SDK keys or CLI).
  if (await checkClaudeAvailable()) {
    for (const m of listClaudeModels()) {
      models.push({
        name: m.name,
        provider: "claude",
        displayName: m.displayName,
      });
    }
  }

  // Add Ollama models if available
  if (await checkOllamaRunning()) {
    const ollamaModels = await listOllamaModels();
    for (const m of ollamaModels) {
      models.push({ name: m.name, provider: "ollama" });
    }
  }

  return models;
}
