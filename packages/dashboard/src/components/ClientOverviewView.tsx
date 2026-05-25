import { RefreshCw, Loader2, ExternalLink } from 'lucide-react'

interface InfraNode {
  id: string
  type: string
  label: string
  port?: number
  status: 'running' | 'stopped' | 'unknown'
}

interface Props {
  clientName: string
  infra: InfraNode[]
  loading: boolean
  onRefresh: () => void
}

// Mirrors NODE_PALETTE from the ontology types — colors aligned with the
// Graph tab so the user sees the same hues in both places.
const PALETTE: Record<string, string> = {
  kafka:      '#f97316',
  postgres:   '#38bdf8',
  redis:      '#f87171',
  jenkins:    '#fbbf24',
  dashboard:  '#a78bfa',
  grafana:    '#fb923c',
  prometheus: '#ef4444',
  tempo:      '#c084fc',
  loki:       '#34d399',
  keycloak:   '#4a90d9',
  localstack: '#e11d48',
  clickhouse: '#f59e0b',
  mlflow:     '#3b82f6',
  mage:       '#10b981',
}

// External UIs that a user might want to open straight from the card.
const UI_URLS: Record<string, (port: number) => string> = {
  grafana:    p => `http://localhost:${p}`,
  jenkins:    p => `http://localhost:${p}`,
  prometheus: p => `http://localhost:${p}`,
  mage:       p => `http://localhost:${p}`,
  mlflow:     p => `http://localhost:${p}`,
  keycloak:   p => `http://localhost:${p}/admin`,
  clickhouse: p => `http://localhost:${p}/play`,
  localstack: p => `http://localhost:${p}/_localstack/health`,
}

export function ClientOverviewView({ clientName, infra, loading, onRefresh }: Props) {
  const running = infra.filter(n => n.status === 'running').length
  const total = infra.length

  return (
    <div className="flex-1 flex flex-col">
      <div className="border-b border-gray-800 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider">Client</div>
            <h1 className="text-2xl font-semibold font-mono text-blue-300 mt-1">{clientName}</h1>
            <div className="text-sm text-gray-400 mt-1">
              {running}/{total} infrastructure components running
            </div>
          </div>
          <button
            onClick={onRefresh}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            title="Refresh"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5 text-gray-400" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {infra.length === 0 && !loading && (
          <div className="text-center text-gray-500 mt-12">
            <p>No infrastructure to display.</p>
            <p className="text-xs mt-2">This client has no infra components enabled.</p>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {infra.map(node => {
            const color = PALETTE[node.type] ?? '#64748b'
            const statusColor =
              node.status === 'running' ? 'bg-green-400'
              : node.status === 'stopped' ? 'bg-red-400'
              : 'bg-gray-500'
            const url = node.port && UI_URLS[node.type]?.(node.port)
            return (
              <div
                key={node.id}
                className="bg-gray-800 rounded-lg p-4 border border-gray-700"
                style={{ borderTopColor: color, borderTopWidth: 3 }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                    <span className="font-semibold" style={{ color }}>{node.label}</span>
                  </div>
                  <span className="text-xs text-gray-500 uppercase">{node.status}</span>
                </div>
                {node.port && (
                  <div className="text-xs text-gray-400 font-mono">
                    localhost:{node.port}
                  </div>
                )}
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open UI
                  </a>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
