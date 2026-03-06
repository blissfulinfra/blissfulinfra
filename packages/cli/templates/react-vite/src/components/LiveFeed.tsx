import { useEffect, useRef, useState, KeyboardEvent } from 'react'
import { useSseStream } from '@/hooks/useSseStream'
import { cn } from '@/lib/utils'

interface GreetingEventData {
  eventId: string
  name: string
  eventType: string
  occurredAt: string
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/**
 * Live Event Feed — demonstrates Server-Sent Events (SSE).
 *
 * Flow:
 *   1. User enters a name and clicks "Greet"
 *   2. Frontend calls GET /api/hello/:name  (triggers a GreetingEvent published to Kafka)
 *   3. Backend Kafka consumer receives the event and pushes it to SseController
 *   4. SseController sends an SSE frame (event: greeting.created) to all connected clients
 *   5. This component's EventSource listener receives it and appends it to the feed
 *
 * Contrast with the WebSocket chat above:
 *   - SSE is server → client only (no send from browser)
 *   - Uses the native EventSource API with browser-managed auto-reconnect
 *   - Each frame carries a named event type matching the domain event type
 */
export function LiveFeed() {
  const [nameInput, setNameInput] = useState('')
  const [greeting, setGreeting] = useState<{ message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { connected, events, clearEvents } = useSseStream<GreetingEventData>(
    '/api/events/stream',
    { eventTypes: ['greeting.created'] },
  )

  // Auto-scroll to latest event
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const greet = async () => {
    const name = nameInput.trim()
    if (!name) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hello/${encodeURIComponent(name)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { message: string }
      setGreeting(data)
      setNameInput('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') greet()
  }

  return (
    <div className="flex flex-col rounded-lg border bg-card text-card-foreground shadow-sm h-[480px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Live Event Feed</span>
          {/* Pulsing dot when connected */}
          <span className="relative flex h-2 w-2">
            {connected && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            )}
            <span className={cn('relative inline-flex rounded-full h-2 w-2', connected ? 'bg-green-500' : 'bg-yellow-400')} />
          </span>
          <span className="text-xs text-muted-foreground">
            {connected ? 'Streaming' : 'Connecting…'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {events.length > 0 && (
            <span className="text-xs text-muted-foreground">{events.length} event{events.length !== 1 ? 's' : ''}</span>
          )}
          <button
            onClick={clearEvents}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 font-mono text-xs">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground font-sans">
            <span className="text-2xl">📡</span>
            <p className="text-sm">Waiting for events…</p>
            <p className="text-xs">Enter a name below to trigger a greeting event via Kafka → SSE</p>
          </div>
        ) : (
          events.map(entry => (
            <div
              key={entry.id}
              className="flex items-start gap-3 rounded-md bg-muted/50 px-3 py-2 border border-border/40"
            >
              {/* Event type badge */}
              <span className="shrink-0 mt-0.5 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {entry.type}
              </span>

              {/* Payload */}
              <div className="flex-1 min-w-0">
                <span className="text-foreground font-semibold">
                  Hello, {entry.data.name}!
                </span>
                <span className="ml-2 text-muted-foreground truncate">
                  id: {entry.data.eventId?.slice(0, 8)}…
                </span>
              </div>

              {/* Timestamp */}
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatTime(entry.receivedAt)}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* API trigger bar */}
      <div className="border-t px-4 py-3 space-y-2">
        {greeting && (
          <p className="text-xs text-muted-foreground">
            ↳ API responded: <span className="text-foreground">{greeting.message}</span>
          </p>
        )}
        {error && (
          <p className="text-xs text-red-500">Error: {error}</p>
        )}
        <div className="flex items-center gap-2">
          <input
            className="flex-1 h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Enter a name to greet…"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={greet}
            disabled={loading || !nameInput.trim()}
            className="h-9 px-4 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {loading ? '…' : 'Greet'}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Calls <code className="bg-muted px-1 rounded">GET /api/hello/:name</code> → Kafka → SSE stream
        </p>
      </div>
    </div>
  )
}
