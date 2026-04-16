import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ChatWindow } from '@/components/ChatWindow'
import { LiveFeed } from '@/components/LiveFeed'
// {{#IF_LOCALSTACK}}
import { FileManager } from '@/components/FileManager'
{{/IF_LOCALSTACK}}

interface HealthResponse {
  status: string
  timestamp: string
}

interface HelloResponse {
  message: string
}

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error('Failed to fetch health')
  return res.json()
}

async function fetchHello(name?: string): Promise<HelloResponse> {
  const url = name ? `/api/hello/${name}` : '/api/hello'
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch hello')
  return res.json()
}

export default function HomePage() {
  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  })

  const { data: hello, isLoading: helloLoading } = useQuery({
    queryKey: ['hello'],
    queryFn: () => fetchHello(),
  })

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold mb-4">Welcome to {"{{PROJECT_NAME}}"}</h1>
        <p className="text-muted-foreground">
          Your full-stack application is ready to go.
        </p>
      </section>

      {/* Side-by-side: WebSocket chat + SSE event feed */}
      <div className="grid gap-4 md:grid-cols-2">
        <ChatWindow />
        <LiveFeed />
      </div>

{/* {{#IF_LOCALSTACK}} */}
      <FileManager />
{/* {{/IF_LOCALSTACK}} */}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <Card.Header>
            <Card.Title>API Health</Card.Title>
          </Card.Header>
          <Card.Content>
            {healthLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : health ? (
              <div className="space-y-2">
                <p>
                  Status:{' '}
                  <span className={health.status === 'healthy' ? 'text-green-600' : 'text-red-600'}>
                    {health.status}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {new Date(health.timestamp).toLocaleString()}
                </p>
              </div>
            ) : (
              <p className="text-red-600">API unavailable</p>
            )}
          </Card.Content>
          <Card.Footer>
            <Button onClick={() => refetchHealth()} variant="outline" size="sm">
              Refresh
            </Button>
          </Card.Footer>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>Hello API</Card.Title>
          </Card.Header>
          <Card.Content>
            {helloLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : hello ? (
              <p className="text-lg">{hello.message}</p>
            ) : (
              <p className="text-red-600">Failed to load</p>
            )}
          </Card.Content>
        </Card>
      </div>
    </div>
  )
}
