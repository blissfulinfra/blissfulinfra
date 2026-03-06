import { useEffect, useRef, useState, useCallback } from 'react'

export interface SseEvent<T = unknown> {
  id: string
  type: string
  data: T
  receivedAt: number
}

interface UseSseStreamOptions {
  /** Map of SSE event names to listen for. '*' catches all named + unnamed events. */
  eventTypes?: string[]
  /** Called for every received event before it is added to the list. */
  onEvent?: (event: SseEvent) => void
  /** Max events kept in state (oldest are dropped). Default 50. */
  maxEvents?: number
}

/**
 * Subscribes to a Server-Sent Events stream using the native EventSource API.
 *
 * Contrast with useWebSocket:
 *   - Unidirectional: server → client only
 *   - Browser auto-reconnects on drop (no manual retry logic needed)
 *   - Plain HTTP — works through proxies and CDNs without upgrade negotiation
 *
 * Example:
 *   const { connected, events } = useSseStream('/api/events/stream', {
 *     eventTypes: ['greeting.created'],
 *   })
 */
export function useSseStream<T = unknown>(url: string, options: UseSseStreamOptions = {}) {
  const { eventTypes = ['message'], onEvent, maxEvents = 50 } = options

  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<SseEvent<T>[]>([])
  const esRef = useRef<EventSource | null>(null)
  // stable ref for onEvent callback so the effect doesn't re-run on every render
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const push = useCallback((raw: MessageEvent, type: string) => {
    let data: T
    try {
      data = JSON.parse(raw.data) as T
    } catch {
      data = raw.data as unknown as T
    }

    const entry: SseEvent<T> = {
      id: raw.lastEventId || `${Date.now()}-${Math.random()}`,
      type,
      data,
      receivedAt: Date.now(),
    }

    onEventRef.current?.(entry as SseEvent)
    setEvents(prev => {
      const next = [...prev, entry]
      return next.length > maxEvents ? next.slice(next.length - maxEvents) : next
    })
  }, [maxEvents])

  useEffect(() => {
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    // Attach a listener for every requested event type
    const cleanup: (() => void)[] = []

    for (const type of eventTypes) {
      const handler = (e: MessageEvent) => push(e, type)
      es.addEventListener(type, handler)
      cleanup.push(() => es.removeEventListener(type, handler))
    }

    return () => {
      cleanup.forEach(fn => fn())
      es.close()
      esRef.current = null
      setConnected(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const clearEvents = useCallback(() => setEvents([]), [])

  return { connected, events, clearEvents }
}
