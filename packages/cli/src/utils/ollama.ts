export interface OllamaConfig {
  endpoint: string;
  models: {
    analysis: string;
    quick: string;
  };
}

export interface OllamaModel {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

function getDefaultEndpoint(): string {
  return process.env.DOCKER_MODE === "true"
    ? "http://host.docker.internal:11434"
    : "http://localhost:11434";
}

const DEFAULT_CONFIG: OllamaConfig = {
  get endpoint() {
    return getDefaultEndpoint();
  },
  models: {
    analysis: "llama3.1:70b",
    quick: "llama3.1:8b",
  },
};

/**
 * Check if Ollama is running and accessible
 */
export async function checkOllamaRunning(
  endpoint = DEFAULT_CONFIG.endpoint
): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * List available models from Ollama
 */
export async function listModels(
  endpoint = DEFAULT_CONFIG.endpoint
): Promise<OllamaModel[]> {
  try {
    const response = await fetch(`${endpoint}/api/tags`);
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as { models: OllamaModel[] };
    return data.models || [];
  } catch {
    return [];
  }
}

/**
 * Check if a specific model is available
 */
export async function hasModel(
  modelName: string,
  endpoint = DEFAULT_CONFIG.endpoint
): Promise<boolean> {
  const models = await listModels(endpoint);
  return models.some(
    (m) => m.name === modelName || m.name.startsWith(`${modelName}:`)
  );
}

/**
 * Select the best available model with fallback
 */
export async function selectModel(
  endpoint = DEFAULT_CONFIG.endpoint
): Promise<string | null> {
  const models = await listModels(endpoint);
  const modelNames = models.map((m) => m.name);

  // Preference order: larger models first, with fallback to smaller
  const preferences = [
    "llama3.1:70b",
    "llama3.1:8b",
    "llama3:70b",
    "llama3:8b",
    "llama2:70b",
    "llama2:13b",
    "llama2:7b",
    "mistral:7b",
    "codellama:34b",
    "codellama:13b",
    "codellama:7b",
  ];

  for (const pref of preferences) {
    if (modelNames.includes(pref)) {
      return pref;
    }
  }

  // Return first available model if none from preferences
  return modelNames.length > 0 ? modelNames[0] : null;
}

/**
 * Send a chat completion request to Ollama
 */
export async function chat(
  model: string,
  messages: ChatMessage[],
  endpoint = DEFAULT_CONFIG.endpoint
): Promise<string> {
  const response = await fetch(`${endpoint}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.statusText}`);
  }

  const data = (await response.json()) as ChatResponse;
  return data.message.content;
}

/**
 * Stream a chat completion request to Ollama
 */
export async function* chatStream(
  model: string,
  messages: ChatMessage[],
  endpoint = DEFAULT_CONFIG.endpoint
): AsyncGenerator<string, void, unknown> {
  const response = await fetch(`${endpoint}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const data = JSON.parse(line) as ChatResponse;
          if (data.message?.content) {
            yield data.message.content;
          }
        } catch {
          // Skip invalid JSON lines
        }
      }
    }
  }
}
