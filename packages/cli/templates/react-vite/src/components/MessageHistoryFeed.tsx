import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'

interface ChatMessageDto {
  id: number
  sessionId: string
  author: string
  body: string
  createdAt: string
}

interface ChatHistoryResponse {
  messages: ChatMessageDto[]
  total: number
}

async function fetchMessages(limit = 50): Promise<ChatHistoryResponse> {
  const res = await fetch(`/api/messages?limit=${limit}`)
  if (!res.ok) throw new Error('Failed to fetch messages')
  return res.json()
}

function formatTimestamp(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Initials avatar for a given name
function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/[\s-_]+/)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? '')
    .join('')
  // Pick a stable hue from the name string
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return (
    <div
      className="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white select-none"
      style={{ background: `hsl(${hue}, 55%, 45%)` }}
    >
      {initials || '?'}
    </div>
  )
}

export function MessageHistoryFeed() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['messages'],
    queryFn: () => fetchMessages(50),
    refetchInterval: 15_000, // poll every 15 s
  })

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b">
        <div>
          <h3 className="font-semibold">Message History</h3>
          <p className="text-xs text-muted-foreground">
            Persisted to Postgres · {data?.total ?? '—'} messages
          </p>
        </div>
      </div>

      {/* Feed */}
      <div className="divide-y max-h-[360px] overflow-y-auto">
        {isLoading && (
          <div className="px-5 py-8 text-center text-muted-foreground text-sm">
            Loading…
          </div>
        )}

        {isError && (
          <div className="px-5 py-8 text-center text-sm text-red-500">
            Could not load messages — is the backend running with Postgres?
          </div>
        )}

        {data?.messages.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No messages yet. Send one in the chat!
          </div>
        )}

        {data?.messages.map((msg, i) => (
          <div
            key={msg.id}
            className={cn(
              'flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/30',
              i % 2 === 0 ? '' : 'bg-muted/10'
            )}
          >
            <Avatar name={msg.author} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium truncate">{msg.author}</span>
                <span className="text-[10px] text-muted-foreground flex-shrink-0">
                  {formatTimestamp(msg.createdAt)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground break-words">{msg.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
