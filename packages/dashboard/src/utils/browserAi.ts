/**
 * Thin wrapper around Chrome's built-in AI APIs (Gemini Nano). Runs the
 * model entirely on-device, no network, no API key.
 *
 *   https://developer.chrome.com/docs/ai/prompt-api
 *
 * Surfaces as `window.LanguageModel` in Chrome 138+. Earlier versions
 * exposed `window.ai.languageModel`; we probe both. The model weights
 * are downloaded once (~2 GB) and cached; the first session may report
 * `downloadable` / `downloading` before becoming `available`.
 */

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

interface LanguageModelCreateOptions {
  systemPrompt?: string
  temperature?: number
  topK?: number
  initialPrompts?: Array<{ role: 'user' | 'assistant'; content: string }>
  monitor?: (m: { addEventListener: (ev: string, cb: (e: { loaded: number }) => void) => void }) => void
}

interface LanguageModelSession {
  prompt: (input: string) => Promise<string>
  promptStreaming: (input: string) => AsyncIterable<string>
  destroy: () => void
}

interface LanguageModelGlobal {
  availability: (opts?: LanguageModelCreateOptions) => Promise<Availability>
  create: (opts?: LanguageModelCreateOptions) => Promise<LanguageModelSession>
}

declare global {
  interface Window {
    LanguageModel?: LanguageModelGlobal
    ai?: { languageModel?: LanguageModelGlobal }
  }
}

function getApi(): LanguageModelGlobal | null {
  if (typeof window === 'undefined') return null
  if (window.LanguageModel) return window.LanguageModel
  if (window.ai?.languageModel) return window.ai.languageModel
  return null
}

export async function browserAiAvailability(): Promise<Availability> {
  const api = getApi()
  if (!api) return 'unavailable'
  try {
    return await api.availability()
  } catch {
    return 'unavailable'
  }
}

export interface BrowserAiMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * One-shot streaming prompt. Pass the full message history each call —
 * Chrome's Prompt API takes `initialPrompts` plus a final prompt string,
 * so we split off the last user message and feed the rest as initial.
 */
export async function* browserAiChatStream(
  history: BrowserAiMessage[],
  systemPrompt?: string,
): AsyncGenerator<string, void, unknown> {
  const api = getApi()
  if (!api) throw new Error('Chrome built-in AI is not available in this browser.')

  if (history.length === 0) return
  const lastUser = [...history].reverse().find(m => m.role === 'user')
  if (!lastUser) return
  const lastIdx = history.lastIndexOf(lastUser)
  const initialPrompts = history.slice(0, lastIdx)

  let session: LanguageModelSession | null = null
  try {
    session = await api.create({
      systemPrompt,
      initialPrompts: initialPrompts.length > 0 ? initialPrompts : undefined,
    })
    const stream = session.promptStreaming(lastUser.content)
    for await (const chunk of stream) {
      yield chunk
    }
  } finally {
    session?.destroy()
  }
}

export function browserAiStatusLabel(a: Availability): string {
  switch (a) {
    case 'available': return 'on-device · ready'
    case 'downloadable': return 'on-device · downloads on first use'
    case 'downloading': return 'on-device · downloading model'
    case 'unavailable': return 'on-device · unsupported in this browser'
  }
}
