import { useEffect, useRef, useState, KeyboardEvent } from 'react'
import { useWebSocket } from '@/hooks/useWebSocket'
import { cn } from '@/lib/utils'

interface ChatMessage {
  id: string
  kind: 'chat' | 'system'
  from?: string       // display name of sender (chat messages)
  sessionId?: string  // used to detect own messages
  text: string
  timestamp: number
}

interface WsPayload {
  from?: string
  sessionId?: string
  text?: string
  name?: string
  oldName?: string
  newName?: string
  count?: number
  message?: string
}

interface WsEvent {
  type: string
  payload: WsPayload
  timestamp: number
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function ChatWindow() {
  const [mySessionId, setMySessionId] = useState<string | null>(null)
  const [myName, setMyName] = useState<string>('')
  const [pendingName, setPendingName] = useState<string>('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [onlineCount, setOnlineCount] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  const pushSystem = (text: string, timestamp = Date.now()) => {
    setChatMessages(prev => [...prev, {
      id: `sys-${timestamp}-${Math.random()}`,
      kind: 'system',
      text,
      timestamp,
    }])
  }

  const { connected, send } = useWebSocket('/ws/events', {
    onMessage: (raw) => {
      try {
        const event: WsEvent = JSON.parse(raw)
        const { type, payload, timestamp } = event

        switch (type) {
          case 'connected':
            setMySessionId(payload.sessionId ?? null)
            setMyName(payload.name ?? '')
            setOnlineCount(prev => prev + 1)
            pushSystem(`Connected as ${payload.name}`, timestamp)
            break

          case 'chat':
            setChatMessages(prev => [...prev, {
              id: `msg-${timestamp}-${Math.random()}`,
              kind: 'chat',
              from: payload.from,
              sessionId: payload.sessionId,
              text: payload.text ?? '',
              timestamp,
            }])
            break

          case 'user-joined':
            setOnlineCount(payload.count ?? 0)
            pushSystem(`${payload.name} joined`, timestamp)
            break

          case 'user-left':
            setOnlineCount(payload.count ?? 0)
            pushSystem(`${payload.name} left`, timestamp)
            break

          case 'name-changed':
            setMyName(payload.name ?? '')
            pushSystem(`You are now known as ${payload.name}`, timestamp)
            break

          case 'user-renamed':
            pushSystem(`${payload.oldName} is now ${payload.newName}`, timestamp)
            break
        }
      } catch {
        // ignore malformed frames
      }
    },
  })

  // Auto-scroll to the latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const sendChat = () => {
    const text = input.trim()
    if (!text || !connected) return
    send({ type: 'chat', payload: { text } })
    setInput('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendChat()
    }
  }

  const handleRename = () => {
    const name = pendingName.trim()
    if (!name) return
    send({ type: 'set-name', payload: { name } })
    setPendingName('')
  }

  return (
    <div className="flex flex-col rounded-lg border bg-card text-card-foreground shadow-sm h-[480px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Live Chat</span>
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              connected ? 'bg-green-500' : 'bg-yellow-400'
            )}
          />
          <span className="text-xs text-muted-foreground">
            {connected ? `${onlineCount} online` : 'reconnecting…'}
          </span>
        </div>
        {/* Inline rename */}
        <div className="flex items-center gap-1">
          <input
            className="h-6 w-28 rounded border px-2 text-xs bg-background"
            placeholder={myName || 'Set name…'}
            value={pendingName}
            onChange={e => setPendingName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRename()}
          />
          <button
            onClick={handleRename}
            disabled={!pendingName.trim()}
            className="h-6 px-2 text-xs rounded border bg-muted hover:bg-muted/80 disabled:opacity-40"
          >
            Rename
          </button>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {chatMessages.length === 0 && (
          <p className="text-center text-xs text-muted-foreground pt-8">
            No messages yet — say hello!
          </p>
        )}

        {chatMessages.map(msg => {
          if (msg.kind === 'system') {
            return (
              <div key={msg.id} className="flex justify-center">
                <span className="text-xs text-muted-foreground italic">
                  {msg.text} · {formatTime(msg.timestamp)}
                </span>
              </div>
            )
          }

          const isOwn = msg.sessionId === mySessionId
          return (
            <div
              key={msg.id}
              className={cn('flex flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}
            >
              <span className="text-xs text-muted-foreground px-1">
                {isOwn ? 'You' : msg.from}
              </span>
              <div
                className={cn(
                  'max-w-[75%] rounded-2xl px-3 py-2 text-sm break-words',
                  isOwn
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-muted rounded-bl-sm'
                )}
              >
                {msg.text}
              </div>
              <span className="text-[10px] text-muted-foreground px-1">
                {formatTime(msg.timestamp)}
              </span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-t">
        <input
          className="flex-1 h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          placeholder={connected ? 'Type a message…' : 'Waiting for connection…'}
          value={input}
          disabled={!connected}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          onClick={sendChat}
          disabled={!connected || !input.trim()}
          className="h-9 px-4 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  )
}
