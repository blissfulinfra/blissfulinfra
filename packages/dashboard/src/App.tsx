import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts'
import {
  Play,
  Square,
  RefreshCw,
  Terminal,
  MessageSquare,
  Activity,
  Send,
  Loader2,
  Plus,
  Trash2,
  FolderOpen,
  ChevronRight,
  AlertCircle,
  Copy,
  Check,
  X,
  HardDrive,
  Network,
  BarChart3,
  CheckCircle,
  XCircle,
  HelpCircle,
  GitBranch,
  Server,
  ArrowUpCircle,
  RotateCcw,
  ExternalLink,
  Eye,
  EyeOff,
  Download,
  Settings as SettingsIcon,
  Puzzle,
  ExternalLink as OpenIcon,
  Database,
  Cpu,
  Workflow,
} from 'lucide-react'

interface Project {
  name: string
  path: string
  status: 'running' | 'stopped' | 'unknown'
  type: string
  backend?: string
  frontend?: string
  database?: string
  services: Service[]
}

interface Service {
  name: string
  status: 'running' | 'stopped' | 'starting' | 'unhealthy'
  port?: number
}

interface LogEntry {
  timestamp: string
  service: string
  message: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Templates {
  types: string[]
  backends: string[]
  frontends: string[]
  databases: string[]
}

interface AIModel {
  name: string
  provider: 'claude' | 'ollama'
  displayName?: string
}

interface ModelsResponse {
  available: boolean
  provider: 'claude' | 'ollama' | null
  models: AIModel[]
  recommended?: { provider: string; model: string }
  error?: string
}

interface ContainerMetrics {
  name: string
  cpuPercent: number
  memoryUsage: number
  memoryLimit: number
  memoryPercent: number
  networkRx: number
  networkTx: number
}

interface HttpMetrics {
  totalRequests: number
  requestsPerSecond: number
  avgResponseTime: number
  p50Latency?: number
  p95Latency?: number
  p99Latency?: number
  errorCount?: number
  errorRate?: number
  status2xx?: number
  status4xx?: number
  status5xx?: number
}

interface MetricsResponse {
  containers: ContainerMetrics[]
  httpMetrics?: HttpMetrics
  timestamp: number
}

interface MetricsHistory {
  timestamps: number[]
  containers: Record<string, { cpu: number[]; memory: number[] }>
  http: {
    requestsPerSecond: number[]
    avgResponseTime: number[]
    p50Latency: number[]
    p95Latency: number[]
    p99Latency: number[]
    errorRate: number[]
    lastTotalRequests: number
  }
}

interface ServiceHealth {
  name: string
  status: 'healthy' | 'unhealthy' | 'unknown'
  responseTimeMs?: number
  lastChecked: number
  details?: string
}

interface HealthResponse {
  services: ServiceHealth[]
  timestamp: number
}

interface PluginStatus {
  key: string
  type: string
  displayName: string
  description: string
  category: string
  color: string
  port: number
  uiUrl: string | null
  uiLabel: string | null
  status: 'healthy' | 'unhealthy' | 'unknown'
  responseTimeMs?: number
  isDataPlatform: boolean
}

interface HealthHistory {
  timestamps: number[]
  services: Record<string, ('healthy' | 'unhealthy' | 'unknown')[]>
}

interface StoredMetrics {
  timestamp: number
  projectName: string
  containers: Array<{
    name: string
    cpuPercent: number
    memoryPercent: number
  }>
  http?: {
    totalRequests: number
    avgResponseTime: number
    p50Latency?: number
    p95Latency?: number
    p99Latency?: number
    errorRate?: number
  }
}

interface HistoricalMetricsResponse {
  metrics: StoredMetrics[]
  count: number
}

interface AlertThreshold {
  id: string
  name: string
  metric: string
  operator: string
  value: number
  container?: string
  enabled: boolean
  severity: 'warning' | 'critical'
}

interface TriggeredAlert {
  id: string
  thresholdId: string
  name: string
  metric: string
  value: number
  threshold: number
  severity: 'warning' | 'critical'
  triggeredAt: number
  resolvedAt?: number
  container?: string
}

interface AlertsResponse {
  config: {
    thresholds: AlertThreshold[]
    notifyOnConsole: boolean
    cooldownMs: number
  }
  activeAlerts: TriggeredAlert[]
  recentHistory: TriggeredAlert[]
}

interface PipelineStage {
  name: string
  status: 'success' | 'failure' | 'running' | 'skipped' | 'pending'
}

interface PipelineData {
  lastRun?: {
    status: 'success' | 'failure' | 'running' | 'unknown'
    duration?: number
    timestamp?: string
    stages: PipelineStage[]
  }
  jenkinsUrl?: string
}

interface EnvironmentInfo {
  name: string
  version: string
  status: 'Synced' | 'OutOfSync' | 'Progressing' | 'Missing' | 'Unknown'
  health: 'Healthy' | 'Degraded' | 'Progressing' | 'Missing' | 'Unknown'
  replicas: string
  lastDeployed?: string
}

interface LogConfig {
  maxFileSize: number
  maxRetentionDays: number
  maxFiles: number
  persist: boolean
}

interface LogStats {
  totalSize: number
  fileCount: number
}

interface MetricsStorage {
  totalSize: number
  dataPoints: number
  fileCount: number
}

// Time window options
const TIME_WINDOWS = [
  { label: '1m', value: 60, dataPoints: 60, intervalMs: 1000 },
  { label: '5m', value: 300, dataPoints: 60, intervalMs: 5000 },
  { label: '15m', value: 900, dataPoints: 90, intervalMs: 10000 },
  { label: '1h', value: 3600, dataPoints: 120, intervalMs: 30000 },
  { label: '24h', value: 86400, dataPoints: 144, intervalMs: 600000 },
] as const

type TimeWindow = (typeof TIME_WINDOWS)[number]

// Format timestamp for x-axis display
function formatTime(timestamp: number, windowSeconds: number): string {
  const date = new Date(timestamp)
  if (windowSeconds <= 300) {
    // 5 minutes or less: show HH:MM:SS
    return date.toLocaleTimeString('en-US', { hour12: false })
  } else if (windowSeconds <= 3600) {
    // 1 hour or less: show HH:MM
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  } else {
    // More than 1 hour: show MM/DD HH:MM
    return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }) + ' ' +
      date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
}

// Time Series Chart Component using Recharts
function TimeSeriesChart({
  data,
  timestamps,
  color,
  maxValue,
  label,
  unit = '%',
  windowSeconds = 60,
}: {
  data: number[]
  timestamps: number[]
  color: string
  maxValue?: number
  label: string
  unit?: string
  windowSeconds?: number
}) {
  const currentValue = data.length > 0 ? data[data.length - 1] : 0

  // Calculate time domain - include historical data if available
  const now = Date.now()
  const dataStart = timestamps.length > 0 ? timestamps[0] : now
  const windowStart = Math.min(dataStart, now - windowSeconds * 1000)
  const timeDomain: [number, number] = [windowStart, now]

  // Convert to recharts format
  const chartData = data.map((value, i) => ({
    time: timestamps[i] || Date.now(),
    value,
  }))

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-400">{label}</span>
        <span className="text-sm font-mono">
          {currentValue.toFixed(1)}{unit}
        </span>
      </div>
      <div className="bg-gray-900 rounded-lg overflow-hidden h-32">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-600 text-sm">
            No data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id={`gradient-${label.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                domain={timeDomain}
                tickFormatter={(ts) => formatTime(ts, windowSeconds)}
                stroke="#6b7280"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickCount={5}
              />
              <YAxis
                domain={maxValue !== undefined ? [0, maxValue] : ['auto', 'auto']}
                stroke="#6b7280"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v) => `${v}${unit}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '0.5rem',
                  fontSize: '12px',
                }}
                labelFormatter={(ts) => formatTime(ts as number, windowSeconds)}
                formatter={(value) => [`${Number(value).toFixed(2)}${unit}`, label]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill={`url(#gradient-${label.replace(/\s+/g, '-')})`}
                dot={false}
                activeDot={{ r: 4, fill: color }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function categoryIcon(category: string) {
  if (category === 'AI/ML') return <Cpu className="w-3 h-3" />
  if (category === 'Data') return <Database className="w-3 h-3" />
  if (category === 'Orchestration') return <Workflow className="w-3 h-3" />
  return <Server className="w-3 h-3" />
}

function PluginCard({ plugin }: { plugin: PluginStatus }) {
  return (
    <div
      className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden hover:border-gray-600 transition-colors"
      style={{ borderLeftColor: plugin.color, borderLeftWidth: 3 }}
    >
      <div className="p-4 space-y-3">
        {/* Header: name + category badge */}
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-sm text-white leading-tight">{plugin.displayName}</span>
          <span
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
            style={{ backgroundColor: plugin.color + '22', color: plugin.color }}
          >
            {categoryIcon(plugin.category)}
            {plugin.category}
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-gray-400 leading-relaxed">{plugin.description}</p>

        {/* Status row */}
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            plugin.status === 'healthy' ? 'bg-green-400' :
            plugin.status === 'unhealthy' ? 'bg-red-400' :
            'bg-gray-500'
          }`} />
          <span className={`text-xs font-medium ${
            plugin.status === 'healthy' ? 'text-green-400' :
            plugin.status === 'unhealthy' ? 'text-red-400' :
            'text-gray-500'
          }`}>
            {plugin.status === 'healthy' ? 'Healthy' : plugin.status === 'unhealthy' ? 'Unhealthy' : 'Unknown'}
          </span>
          {plugin.responseTimeMs !== undefined && plugin.status === 'healthy' && (
            <span className="text-xs text-gray-500 ml-auto">{plugin.responseTimeMs}ms</span>
          )}
        </div>

        {/* Port + Open UI button */}
        <div className="flex items-center justify-between pt-1 border-t border-gray-700">
          <span className="text-xs text-gray-500">:{plugin.port}</span>
          {plugin.uiUrl ? (
            <a
              href={plugin.uiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
            >
              <OpenIcon className="w-3 h-3" />
              {plugin.uiLabel ?? 'Open'}
            </a>
          ) : (
            <span className="text-xs text-gray-600 italic">No UI</span>
          )}
        </div>
      </div>
    </div>
  )
}

function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'logs' | 'chat' | 'metrics' | 'plugins' | 'pipeline' | 'environments' | 'deployments' | 'settings'>('logs')
  const [agentLoading, setAgentLoading] = useState(false)
  const [metricsHistory, setMetricsHistory] = useState<MetricsHistory>({
    timestamps: [],
    containers: {},
    http: { requestsPerSecond: [], avgResponseTime: [], p50Latency: [], p95Latency: [], p99Latency: [], errorRate: [], lastTotalRequests: 0 },
  })
  const [metricsLoaded, setMetricsLoaded] = useState(false)
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(TIME_WINDOWS[0])
  const [_healthHistory, setHealthHistory] = useState<HealthHistory>({ timestamps: [], services: {} })
  const [currentHealth, setCurrentHealth] = useState<ServiceHealth[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [templates, setTemplates] = useState<Templates | null>(null)
  const [creating, setCreating] = useState(false)
  const [models, setModels] = useState<ModelsResponse | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [aiProvider, setAiProvider] = useState<'claude' | 'ollama' | null>(null)
  const [errorModal, setErrorModal] = useState<{ title: string; message: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [activeAlerts, setActiveAlerts] = useState<TriggeredAlert[]>([])

  // Plugin state
  const [pluginStatuses, setPluginStatuses] = useState<PluginStatus[]>([])

  // Pipeline state
  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelineOptions, setPipelineOptions] = useState({ push: true, skipTests: false, skipScan: false })

  // Environments state
  const [environments, setEnvironments] = useState<EnvironmentInfo[]>([])
  const [deployingEnv, setDeployingEnv] = useState<string | null>(null)
  const [rollingBackEnv, setRollingBackEnv] = useState<string | null>(null)

  // Deployments state
  const [deployments, setDeployments] = useState<any[]>([])

  // Settings state
  const [alertThresholds, setAlertThresholds] = useState<AlertThreshold[]>([])
  const [logConfig, setLogConfig] = useState<LogConfig>({ maxFileSize: 10, maxRetentionDays: 30, maxFiles: 10, persist: true })
  const [logStats, setLogStats] = useState<LogStats>({ totalSize: 0, fileCount: 0 })
  const [metricsStorage, setMetricsStorage] = useState<MetricsStorage>({ totalSize: 0, dataPoints: 0, fileCount: 0 })
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [editingThreshold, setEditingThreshold] = useState<string | null>(null)
  const [editThresholdValues, setEditThresholdValues] = useState<Partial<AlertThreshold>>({})
  const [newThreshold, setNewThreshold] = useState<Partial<AlertThreshold> | null>(null)

  // Loki state
  const [lokiAvailable, setLokiAvailable] = useState(false)
  const [lokiServices, setLokiServices] = useState<string[]>([])
  const [lokiServiceFilter, setLokiServiceFilter] = useState<string>('all')
  const [lokiLevelFilter, setLokiLevelFilter] = useState<string>('all')
  const [lokiSearch, setLokiSearch] = useState('')

  const logsEndRef = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // New project form state
  const [newProject, setNewProject] = useState({
    name: '',
    type: 'fullstack',
    backend: 'spring-boot',
    frontend: 'react-vite',
    database: 'none',
  })

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects')
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects || [])
        // Update selected project if it exists
        if (selectedProject) {
          const updated = data.projects.find((p: Project) => p.name === selectedProject.name)
          if (updated) setSelectedProject(updated)
        }
      }
    } catch (e) {
      console.error('Failed to fetch projects:', e)
    }
  }

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/templates')
      if (res.ok) {
        const data = await res.json()
        setTemplates(data)
      }
    } catch (e) {
      console.error('Failed to fetch templates:', e)
    }
  }

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models')
      if (res.ok) {
        const data: ModelsResponse = await res.json()
        setModels(data)
        // Only update provider if none is set yet (don't override user's explicit choice)
        if (!aiProvider) {
          setAiProvider(data.provider)
        }
        // Set default model if none selected, or if current model no longer exists
        const currentStillValid = data.models.some(m => m.name === selectedModel)
        if (!currentStillValid) {
          if (data.recommended) {
            setSelectedModel(data.recommended.model)
            setAiProvider(data.recommended.provider as 'claude' | 'ollama')
          } else if (data.models.length > 0) {
            setSelectedModel(data.models[0].name)
            setAiProvider(data.models[0].provider)
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch models:', e)
    }
  }

  const fetchLogs = async () => {
    if (!selectedProject) return
    try {
      const params = new URLSearchParams()
      if (lokiServiceFilter !== 'all') params.set('service', lokiServiceFilter)
      if (lokiSearch) params.set('filter', lokiSearch)
      params.set('limit', '300')
      const lokiRes = await fetch(`/api/projects/${selectedProject.name}/logs/loki?${params}`)
      if (lokiRes.ok) {
        const data = await lokiRes.json()
        if (data.source === 'loki') {
          setLokiAvailable(true)
          let entries: LogEntry[] = data.logs || []
          if (lokiLevelFilter !== 'all') {
            entries = entries.filter(l => detectLogLevel(l.message) === lokiLevelFilter)
          }
          setLogs(entries)
          return
        }
      }
    } catch { /* fall through */ }
    setLokiAvailable(false)
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/logs`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs || [])
      }
    } catch (e) {
      console.error('Failed to fetch logs:', e)
    }
  }

  const fetchLokiServices = async () => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/logs/loki/services`)
      if (res.ok) {
        const data = await res.json()
        setLokiServices(data.services || [])
      }
    } catch { /* ignore */ }
  }

  function detectLogLevel(msg: string): string {
    const m = msg.toLowerCase()
    if (m.includes('error') || m.includes('exception') || m.includes('fatal')) return 'error'
    if (m.includes('warn')) return 'warn'
    if (m.includes('debug') || m.includes('trace')) return 'debug'
    return 'info'
  }

  const fetchHealth = async () => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/health`)
      if (res.ok) {
        const data: HealthResponse = await res.json()
        setCurrentHealth(data.services)

        // Update health history
        setHealthHistory((prev) => {
          const maxDataPoints = timeWindow.dataPoints
          const newTimestamps = [...prev.timestamps, data.timestamp].slice(-maxDataPoints)
          const newServices = { ...prev.services }

          for (const service of data.services) {
            if (!newServices[service.name]) {
              newServices[service.name] = []
            }
            newServices[service.name] = [
              ...newServices[service.name],
              service.status,
            ].slice(-maxDataPoints)
          }

          return { timestamps: newTimestamps, services: newServices }
        })
      }
    } catch (e) {
      console.error('Failed to fetch health:', e)
    }
  }

  const fetchPlugins = async () => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/plugins`)
      if (res.ok) {
        const data: PluginStatus[] = await res.json()
        setPluginStatuses(data)
      }
    } catch (e) {
      console.error('Failed to fetch plugins:', e)
    }
  }

  const fetchMetrics = async () => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/metrics`)
      if (res.ok) {
        const data: MetricsResponse = await res.json()
        setMetricsLoaded(true)

        if (data.containers.length === 0) {
          // No containers running - keep metricsLoaded true but containers empty
          return
        }

        setMetricsHistory((prev) => {
          const maxDataPoints = timeWindow.dataPoints
          const newTimestamps = [...prev.timestamps, data.timestamp].slice(-maxDataPoints)
          const newContainers = { ...prev.containers }

          for (const container of data.containers) {
            if (!newContainers[container.name]) {
              newContainers[container.name] = { cpu: [], memory: [] }
            }
            newContainers[container.name].cpu = [
              ...newContainers[container.name].cpu,
              container.cpuPercent,
            ].slice(-maxDataPoints)
            newContainers[container.name].memory = [
              ...newContainers[container.name].memory,
              container.memoryPercent,
            ].slice(-maxDataPoints)
          }

          // Calculate HTTP metrics (requests per second from delta)
          const newHttp = { ...prev.http }
          if (data.httpMetrics) {
            const deltaRequests = data.httpMetrics.totalRequests - prev.http.lastTotalRequests
            const rps = prev.http.lastTotalRequests > 0 ? Math.max(0, deltaRequests) : 0
            newHttp.requestsPerSecond = [...prev.http.requestsPerSecond, rps].slice(-maxDataPoints)
            newHttp.avgResponseTime = [...prev.http.avgResponseTime, data.httpMetrics.avgResponseTime].slice(-maxDataPoints)
            newHttp.p50Latency = [...prev.http.p50Latency, data.httpMetrics.p50Latency ?? 0].slice(-maxDataPoints)
            newHttp.p95Latency = [...prev.http.p95Latency, data.httpMetrics.p95Latency ?? 0].slice(-maxDataPoints)
            newHttp.p99Latency = [...prev.http.p99Latency, data.httpMetrics.p99Latency ?? 0].slice(-maxDataPoints)
            newHttp.errorRate = [...prev.http.errorRate, data.httpMetrics.errorRate ?? 0].slice(-maxDataPoints)
            newHttp.lastTotalRequests = data.httpMetrics.totalRequests
          }

          return { timestamps: newTimestamps, containers: newContainers, http: newHttp }
        })
      }
    } catch (e) {
      console.error('Failed to fetch metrics:', e)
      setMetricsLoaded(true) // Mark as loaded even on error
    }
  }

  const fetchHistoricalMetrics = async () => {
    if (!selectedProject) return

    try {
      // Fetch historical data for the current time window
      const startTime = Date.now() - timeWindow.value * 1000
      const res = await fetch(
        `/api/projects/${selectedProject.name}/metrics/history?start=${startTime}&limit=${timeWindow.dataPoints}`
      )

      if (res.ok) {
        const data: HistoricalMetricsResponse = await res.json()

        if (data.metrics.length > 0) {
          // Convert historical metrics to chart format
          const timestamps: number[] = []
          const containers: Record<string, { cpu: number[]; memory: number[] }> = {}
          const http = {
            requestsPerSecond: [] as number[],
            avgResponseTime: [] as number[],
            p50Latency: [] as number[],
            p95Latency: [] as number[],
            p99Latency: [] as number[],
            errorRate: [] as number[],
            lastTotalRequests: 0,
          }

          let prevTotalRequests = 0

          for (const m of data.metrics) {
            timestamps.push(m.timestamp)

            // Process container metrics
            for (const c of m.containers) {
              if (!containers[c.name]) {
                containers[c.name] = { cpu: [], memory: [] }
              }
              containers[c.name].cpu.push(c.cpuPercent)
              containers[c.name].memory.push(c.memoryPercent)
            }

            // Process HTTP metrics
            if (m.http) {
              const rps = prevTotalRequests > 0
                ? Math.max(0, m.http.totalRequests - prevTotalRequests)
                : 0
              http.requestsPerSecond.push(rps)
              http.avgResponseTime.push(m.http.avgResponseTime || 0)
              http.p50Latency.push(m.http.p50Latency || 0)
              http.p95Latency.push(m.http.p95Latency || 0)
              http.p99Latency.push(m.http.p99Latency || 0)
              http.errorRate.push(m.http.errorRate || 0)
              prevTotalRequests = m.http.totalRequests
              http.lastTotalRequests = m.http.totalRequests
            }
          }

          setMetricsHistory({ timestamps, containers, http })
        }
      }
    } catch (e) {
      console.error('Failed to fetch historical metrics:', e)
    }
  }

  const fetchAlerts = async () => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/alerts`)
      if (res.ok) {
        const data: AlertsResponse = await res.json()
        setActiveAlerts(data.activeAlerts)
      }
    } catch (e) {
      console.error('Failed to fetch alerts:', e)
    }
  }

  const acknowledgeAllAlerts = async () => {
    if (!selectedProject) return
    try {
      await fetch(`/api/projects/${selectedProject.name}/alerts/acknowledge`, {
        method: 'POST',
      })
      setActiveAlerts([])
    } catch (e) {
      console.error('Failed to acknowledge alerts:', e)
    }
  }

  // --- Pipeline ---
  const fetchPipeline = async () => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/pipeline`)
      if (res.ok) {
        const data = await res.json()
        setPipelineData(data)
      }
    } catch (e) {
      console.error('Failed to fetch pipeline:', e)
    }
  }

  const runPipeline = async () => {
    if (!selectedProject) return
    setPipelineRunning(true)
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pipelineOptions),
      })
      if (res.ok) {
        await fetchPipeline()
      } else {
        const data = await res.json()
        setErrorModal({ title: 'Pipeline Failed', message: data.error || 'Unknown error' })
      }
    } catch (e) {
      console.error('Failed to run pipeline:', e)
    } finally {
      setPipelineRunning(false)
    }
  }

  // --- Environments ---
  const fetchEnvironments = async () => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/environments`)
      if (res.ok) {
        const data = await res.json()
        setEnvironments(data.environments || [])
      }
    } catch (e) {
      console.error('Failed to fetch environments:', e)
    }
  }

  const handleDeploy = async (env: string) => {
    if (!selectedProject) return
    setDeployingEnv(env)
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env }),
      })
      if (!res.ok) {
        const data = await res.json()
        setErrorModal({ title: 'Deploy Failed', message: data.error || 'Unknown error' })
      }
      await fetchEnvironments()
    } catch (e) {
      console.error('Failed to deploy:', e)
    } finally {
      setDeployingEnv(null)
    }
  }

  const handleRollback = async (env: string) => {
    if (!selectedProject) return
    setRollingBackEnv(env)
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env }),
      })
      if (!res.ok) {
        const data = await res.json()
        setErrorModal({ title: 'Rollback Failed', message: data.error || 'Unknown error' })
      }
      await fetchEnvironments()
    } catch (e) {
      console.error('Failed to rollback:', e)
    } finally {
      setRollingBackEnv(null)
    }
  }

  // --- Settings ---
  const fetchSettings = async () => {
    if (!selectedProject) return
    setSettingsLoading(true)
    try {
      const [alertsRes, logConfigRes, metricsRes] = await Promise.all([
        fetch(`/api/projects/${selectedProject.name}/alerts`),
        fetch(`/api/projects/${selectedProject.name}/logs/config`),
        fetch(`/api/projects/${selectedProject.name}/metrics/storage`),
      ])
      if (alertsRes.ok) {
        const data: AlertsResponse = await alertsRes.json()
        setAlertThresholds(data.config.thresholds)
      }
      if (logConfigRes.ok) {
        const data = await logConfigRes.json()
        if (data.config) setLogConfig(data.config)
        if (data.stats) setLogStats(data.stats)
      }
      if (metricsRes.ok) {
        const data = await metricsRes.json()
        setMetricsStorage(data)
      }
    } catch (e) {
      console.error('Failed to fetch settings:', e)
    } finally {
      setSettingsLoading(false)
    }
  }

  const saveAlertThreshold = async (t: AlertThreshold) => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/alerts/thresholds/${t.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t),
      })
      if (res.ok) {
        setEditingThreshold(null)
        await fetchSettings()
      }
    } catch (e) {
      console.error('Failed to save threshold:', e)
    }
  }

  const addAlertThreshold = async (t: Partial<AlertThreshold>) => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/alerts/thresholds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t),
      })
      if (res.ok) {
        setNewThreshold(null)
        await fetchSettings()
      }
    } catch (e) {
      console.error('Failed to add threshold:', e)
    }
  }

  const deleteAlertThreshold = async (id: string) => {
    if (!selectedProject) return
    try {
      await fetch(`/api/projects/${selectedProject.name}/alerts/thresholds/${id}`, {
        method: 'DELETE',
      })
      await fetchSettings()
    } catch (e) {
      console.error('Failed to delete threshold:', e)
    }
  }

  const toggleThreshold = async (t: AlertThreshold) => {
    await saveAlertThreshold({ ...t, enabled: !t.enabled })
  }

  const saveLogRetentionConfig = async () => {
    if (!selectedProject) return
    try {
      await fetch(`/api/projects/${selectedProject.name}/logs/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logConfig),
      })
    } catch (e) {
      console.error('Failed to save log config:', e)
    }
  }

  const handleLogRotate = async () => {
    if (!selectedProject) return
    try {
      await fetch(`/api/projects/${selectedProject.name}/logs/rotate`, { method: 'POST' })
      await fetchSettings()
    } catch (e) {
      console.error('Failed to rotate logs:', e)
    }
  }

  const handleClearLogs = async () => {
    if (!selectedProject || !confirm('Are you sure you want to clear all stored logs?')) return
    try {
      await fetch(`/api/projects/${selectedProject.name}/logs/stored`, { method: 'DELETE' })
      await fetchSettings()
    } catch (e) {
      console.error('Failed to clear logs:', e)
    }
  }

  const handleExportMetrics = async (format: 'json' | 'csv') => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/metrics/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `metrics-${selectedProject.name}.${format}`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      console.error('Failed to export metrics:', e)
    }
  }

  const handleClearMetrics = async () => {
    if (!selectedProject || !confirm('Are you sure you want to clear all stored metrics?')) return
    try {
      await fetch(`/api/projects/${selectedProject.name}/metrics`, { method: 'DELETE' })
      await fetchSettings()
    } catch (e) {
      console.error('Failed to clear metrics:', e)
    }
  }

  useEffect(() => {
    fetchProjects()
    fetchTemplates()
    fetchModels()
    const interval = setInterval(fetchProjects, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (selectedProject) {
      fetchLokiServices()
      fetchLogs()
      const interval = setInterval(fetchLogs, 3000)
      return () => clearInterval(interval)
    }
  }, [selectedProject?.name, lokiServiceFilter, lokiLevelFilter, lokiSearch])

  useEffect(() => {
    if (selectedProject && activeTab === 'metrics') {
      // Clear history when switching projects, tabs, or time window
      setMetricsHistory({
        timestamps: [],
        containers: {},
        http: { requestsPerSecond: [], avgResponseTime: [], p50Latency: [], p95Latency: [], p99Latency: [], errorRate: [], lastTotalRequests: 0 },
      })
      setHealthHistory({ timestamps: [], services: {} })
      setCurrentHealth([])
      setMetricsLoaded(false)

      // Load historical metrics first, then start polling for new data
      const loadData = async () => {
        await fetchHistoricalMetrics()
        setMetricsLoaded(true)
        fetchMetrics()
        fetchHealth()
        fetchAlerts()
      }
      loadData()

      const metricsInterval = setInterval(fetchMetrics, timeWindow.intervalMs)
      const alertsInterval = setInterval(fetchAlerts, 10000) // Check alerts every 10 seconds
      const healthInterval = setInterval(fetchHealth, 5000) // Check health every 5 seconds

      return () => {
        clearInterval(metricsInterval)
        clearInterval(healthInterval)
        clearInterval(alertsInterval)
      }
    }
  }, [selectedProject?.name, activeTab, timeWindow])

  useEffect(() => {
    if (selectedProject && activeTab === 'plugins') {
      fetchPlugins()
      const interval = setInterval(fetchPlugins, 15000)
      return () => clearInterval(interval)
    }
  }, [selectedProject?.name, activeTab])

  useEffect(() => {
    if (selectedProject && activeTab === 'pipeline') {
      fetchPipeline()
      const interval = setInterval(fetchPipeline, 10000)
      return () => clearInterval(interval)
    }
  }, [selectedProject?.name, activeTab])

  useEffect(() => {
    if (selectedProject && activeTab === 'environments') {
      fetchEnvironments()
      const interval = setInterval(fetchEnvironments, 10000)
      return () => clearInterval(interval)
    }
  }, [selectedProject?.name, activeTab])

  useEffect(() => {
    if (selectedProject && activeTab === 'settings') {
      fetchSettings()
    }
  }, [selectedProject?.name, activeTab])

  useEffect(() => {
    if (selectedProject && activeTab === 'deployments') {
      const fetchDeployments = async () => {
        try {
          const res = await fetch(`/api/projects/${selectedProject.name}/deployments`)
          if (res.ok) {
            const data = await res.json()
            setDeployments(data.deployments || [])
          }
        } catch (e) {
          console.error('Failed to fetch deployments:', e)
        }
      }
      fetchDeployments()
    }
  }, [selectedProject?.name, activeTab])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleStart = async () => {
    if (!selectedProject) return
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/up`, { method: 'POST' })
      const data = await res.json()
      if (!data.success && data.error) {
        setErrorModal({
          title: 'Failed to start project',
          message: data.error,
        })
      }
      await fetchProjects()
    } catch (e) {
      setErrorModal({
        title: 'Failed to start project',
        message: e instanceof Error ? e.message : 'Network error',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    if (!selectedProject) return
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/down`, { method: 'POST' })
      const data = await res.json()
      if (!data.success && data.error) {
        setErrorModal({
          title: 'Failed to stop project',
          message: data.error,
        })
      }
      await fetchProjects()
    } catch (e) {
      setErrorModal({
        title: 'Failed to stop project',
        message: e instanceof Error ? e.message : 'Network error',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (projectName: string) => {
    if (!confirm(`Delete project "${projectName}"? This will stop all containers and remove the directory.`)) {
      return
    }
    try {
      await fetch(`/api/projects/${projectName}`, { method: 'DELETE' })
      if (selectedProject?.name === projectName) {
        setSelectedProject(null)
      }
      await fetchProjects()
    } catch (e) {
      console.error('Failed to delete project:', e)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProject.name.trim()) return

    setCreating(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProject),
      })
      const data = await res.json()
      if (data.success) {
        setShowCreateModal(false)
        setNewProject({
          name: '',
          type: 'fullstack',
          backend: 'spring-boot',
          frontend: 'react-vite',
          database: 'none',
        })
        await fetchProjects()
      } else {
        setErrorModal({
          title: 'Failed to create project',
          message: data.error || 'An unknown error occurred',
        })
      }
    } catch (e) {
      console.error('Failed to create project:', e)
      setErrorModal({
        title: 'Failed to create project',
        message: e instanceof Error ? e.message : 'Network error - could not reach server',
      })
    } finally {
      setCreating(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = text
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || agentLoading || !selectedProject) return

    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setAgentLoading(true)

    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userMessage,
          model: selectedModel || undefined,
          // Always derive provider from the selected model so Ollama models work
          // even when Claude is also available
          provider: models?.models.find(m => m.name === selectedModel)?.provider ?? aiProvider ?? undefined,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.response },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Error: Failed to get response from agent' },
        ])
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Error: Could not connect to agent' },
      ])
    } finally {
      setAgentLoading(false)
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'text-green-400'
      case 'stopped':
        return 'text-red-400'
      case 'starting':
        return 'text-yellow-400'
      default:
        return 'text-gray-400'
    }
  }

  const statusDot = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-green-400'
      case 'stopped':
        return 'bg-red-400'
      case 'unhealthy':
        return 'bg-orange-400'
      case 'starting':
        return 'bg-yellow-400'
      default:
        return 'bg-gray-400'
    }
  }

  const envStatusBadge = (status: string) => {
    switch (status) {
      case 'Synced': return 'bg-green-900 text-green-300'
      case 'OutOfSync': return 'bg-yellow-900 text-yellow-300'
      case 'Progressing': return 'bg-blue-900 text-blue-300'
      default: return 'bg-gray-800 text-gray-400'
    }
  }

  const envHealthBadge = (health: string) => {
    switch (health) {
      case 'Healthy': return 'bg-green-900 text-green-300'
      case 'Degraded': return 'bg-red-900 text-red-300'
      case 'Progressing': return 'bg-blue-900 text-blue-300'
      default: return 'bg-gray-800 text-gray-400'
    }
  }

  const pipelineStageBorder = (status: string) => {
    switch (status) {
      case 'success': return 'border-green-500 bg-green-900/30'
      case 'failure': return 'border-red-500 bg-red-900/30'
      case 'running': return 'border-blue-500 bg-blue-900/30'
      default: return 'border-gray-600 bg-gray-800/30'
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-semibold">blissful-infra</h1>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">orchestrator</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="http://localhost:16686"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg transition-colors text-purple-400"
              title="Open Jaeger Distributed Tracing"
            >
              <ExternalLink className="w-4 h-4" />
              Jaeger
            </a>
            <a
              href="http://localhost:3001/d/blissful-service-overview/service-overview"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg transition-colors text-orange-400"
              title="Open Grafana Dashboards"
            >
              <ExternalLink className="w-4 h-4" />
              Grafana
            </a>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Project
            </button>
            <button
              onClick={fetchProjects}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Sidebar - Projects List */}
        <aside className="w-80 border-r border-gray-800 p-4 flex flex-col">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">
            Projects ({projects.length})
          </h2>

          {projects.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-8">
              <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No projects found</p>
              <p className="text-xs mt-2">Click "New Project" to create one</p>
            </div>
          ) : (
            <div className="space-y-2 overflow-auto flex-1">
              {projects.map((project) => (
                <div
                  key={project.name}
                  className={`group bg-gray-800 rounded-lg p-3 cursor-pointer transition-colors ${
                    selectedProject?.name === project.name
                      ? 'ring-2 ring-blue-500'
                      : 'hover:bg-gray-750'
                  }`}
                  onClick={() => {
                    setSelectedProject(project)
                    setMessages([]) // Clear chat when switching projects
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${statusDot(project.status)}`} />
                      <span className="font-medium">{project.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(project.name)
                        }}
                        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-gray-700 rounded transition-all"
                        title="Delete project"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-gray-500" />
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {project.type} {project.backend && `/ ${project.backend}`}
                  </div>
                  {project.services.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
                      {project.services.map((service) => (
                        <span
                          key={service.name}
                          className="flex items-center gap-1 text-xs text-gray-400"
                          title={`${service.name}: ${service.status}${service.port ? ` (:${service.port})` : ''}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(service.status)}`} />
                          {service.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col">
          {selectedProject ? (
            <>
              {/* Project Header */}
              <div className="border-b border-gray-800 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{selectedProject.name}</h2>
                    <div className="flex items-center gap-2 mt-1 text-sm text-gray-400">
                      <span className={statusColor(selectedProject.status)}>
                        {selectedProject.status}
                      </span>
                      <span>-</span>
                      <span>{selectedProject.type}</span>
                      {selectedProject.backend && <span>/ {selectedProject.backend}</span>}
                      {selectedProject.database && selectedProject.database !== 'none' && (
                        <span>/ {selectedProject.database}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleStart}
                      disabled={loading || selectedProject.status === 'running'}
                      className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 px-3 py-2 rounded-lg transition-colors"
                    >
                      {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      Start
                    </button>
                    <button
                      onClick={handleStop}
                      disabled={loading || selectedProject.status === 'stopped'}
                      className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500 px-3 py-2 rounded-lg transition-colors"
                    >
                      {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                      Stop
                    </button>
                  </div>
                </div>

                {/* Service Health */}
                {currentHealth.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {currentHealth.map((service) => {
                      const svcMeta = selectedProject.services.find(s => s.name === service.name)
                      return (
                        <div
                          key={service.name}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border ${
                            service.status === 'healthy'
                              ? 'border-green-500/50 bg-green-500/10'
                              : service.status === 'unhealthy'
                              ? 'border-red-500/50 bg-red-500/10'
                              : 'border-gray-600 bg-gray-700/50'
                          }`}
                        >
                          {service.status === 'healthy' ? (
                            <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                          ) : service.status === 'unhealthy' ? (
                            <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                          ) : (
                            <HelpCircle className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          )}
                          <span className="capitalize">{service.name}</span>
                          {svcMeta?.port && (
                            <a
                              href={`http://localhost:${svcMeta.port}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline"
                            >
                              :{svcMeta.port}
                            </a>
                          )}
                          {service.status === 'unhealthy' && service.details && (
                            <span className="text-red-300 text-xs ml-1">{service.details}</span>
                          )}
                          {service.status === 'healthy' && service.responseTimeMs !== undefined && (
                            <span className="text-gray-500 text-xs">{service.responseTimeMs}ms</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {selectedProject.services.map((service) => (
                      <div
                        key={service.name}
                        className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-lg text-sm"
                      >
                        <span className={`w-2 h-2 rounded-full ${statusDot(service.status)}`} />
                        <span>{service.name}</span>
                        {service.port && (
                          <a
                            href={`http://localhost:${service.port}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline"
                          >
                            :{service.port}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-800">
                <button
                  onClick={() => setActiveTab('logs')}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                    activeTab === 'logs'
                      ? 'border-blue-400 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Terminal className="w-4 h-4" />
                  Logs
                </button>
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                    activeTab === 'chat'
                      ? 'border-blue-400 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  Agent
                </button>
                <button
                  onClick={() => setActiveTab('metrics')}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                    activeTab === 'metrics'
                      ? 'border-blue-400 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <BarChart3 className="w-4 h-4" />
                  Metrics
                </button>
                <button
                  onClick={() => setActiveTab('plugins')}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                    activeTab === 'plugins'
                      ? 'border-purple-400 text-purple-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Puzzle className="w-4 h-4" />
                  Plugins
                  {pluginStatuses.length > 0 && (
                    <span className="ml-1 text-xs bg-purple-500/20 text-purple-300 rounded-full px-1.5 py-0.5">
                      {pluginStatuses.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('pipeline')}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                    activeTab === 'pipeline'
                      ? 'border-blue-400 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <GitBranch className="w-4 h-4" />
                  Pipeline
                </button>
                <button
                  onClick={() => setActiveTab('environments')}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                    activeTab === 'environments'
                      ? 'border-blue-400 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Server className="w-4 h-4" />
                  Environments
                </button>
                <button
                  onClick={() => setActiveTab('deployments')}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                    activeTab === 'deployments'
                      ? 'border-blue-400 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  Deployments
                </button>
                <button
                  onClick={() => setActiveTab('settings')}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                    activeTab === 'settings'
                      ? 'border-blue-400 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <SettingsIcon className="w-4 h-4" />
                  Settings
                </button>
              </div>

              {/* Tab Content */}
              {activeTab === 'logs' ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Toolbar */}
                  <div className="border-b border-gray-800 px-4 py-2 flex flex-wrap items-center gap-2">
                    {/* Source badge */}
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${lokiAvailable ? 'bg-indigo-900 text-indigo-300' : 'bg-gray-700 text-gray-400'}`}>
                      {lokiAvailable ? '⬡ Loki' : '🐳 Docker'}
                    </span>

                    {/* Service filter — only shown when Loki is available */}
                    {lokiAvailable && (
                      <select
                        value={lokiServiceFilter}
                        onChange={e => setLokiServiceFilter(e.target.value)}
                        className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1"
                      >
                        <option value="all">All services</option>
                        {lokiServices.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}

                    {/* Level filter */}
                    {lokiAvailable && (
                      <div className="flex gap-1">
                        {(['all', 'error', 'warn', 'info', 'debug'] as const).map(lvl => (
                          <button
                            key={lvl}
                            onClick={() => setLokiLevelFilter(lvl)}
                            className={`text-xs px-2 py-0.5 rounded font-medium ${
                              lokiLevelFilter === lvl
                                ? lvl === 'error' ? 'bg-red-900 text-red-300'
                                  : lvl === 'warn' ? 'bg-yellow-900 text-yellow-300'
                                  : lvl === 'debug' ? 'bg-gray-600 text-gray-300'
                                  : 'bg-indigo-900 text-indigo-300'
                                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                            }`}
                          >
                            {lvl}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Search */}
                    <input
                      type="text"
                      value={lokiSearch}
                      onChange={e => setLokiSearch(e.target.value)}
                      placeholder="Filter logs..."
                      className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1 w-44 focus:outline-none focus:border-indigo-500"
                    />

                    <span className="ml-auto text-xs text-gray-600">{logs.length} lines</span>
                  </div>

                  {/* Log stream */}
                  <div className="flex-1 overflow-auto p-3 font-mono text-xs">
                    {logs.length === 0 ? (
                      <div className="text-gray-600 p-4 text-center">
                        {lokiAvailable ? 'No logs match the current filters.' : 'No logs yet — start the project to see output.'}
                      </div>
                    ) : (
                      <div className="space-y-px">
                        {logs.map((log, i) => {
                          const level = detectLogLevel(log.message)
                          const levelColor = level === 'error' ? 'text-red-400' : level === 'warn' ? 'text-yellow-400' : level === 'debug' ? 'text-gray-500' : 'text-gray-300'
                          const ts = log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
                          return (
                            <div key={i} className="flex gap-2 hover:bg-gray-800/50 px-1 rounded leading-5">
                              {ts && <span className="text-gray-600 shrink-0 w-20">{ts}</span>}
                              <span className={`shrink-0 w-14 font-semibold ${
                                level === 'error' ? 'text-red-500' : level === 'warn' ? 'text-yellow-500' : level === 'debug' ? 'text-gray-600' : 'text-indigo-400'
                              }`}>{level.toUpperCase()}</span>
                              <span className="text-indigo-300 shrink-0 w-24 truncate">{log.service}</span>
                              <span className={levelColor}>{log.message}</span>
                            </div>
                          )
                        })}
                        <div ref={logsEndRef} />
                      </div>
                    )}
                  </div>
                </div>
              ) : activeTab === 'chat' ? (
                <div className="flex-1 flex flex-col">
                  {/* Provider & Model Selector */}
                  <div className="border-b border-gray-800 px-4 py-3 space-y-2">
                    {!models?.available ? (
                      <p className="text-sm text-yellow-400">
                        No AI provider available — set ANTHROPIC_API_KEY or start Ollama
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Provider toggle buttons — one per connected provider */}
                        {(['claude', 'ollama'] as const)
                          .filter(p => models.models.some(m => m.provider === p))
                          .map(p => (
                            <button
                              key={p}
                              onClick={() => {
                                setAiProvider(p)
                                // Auto-select first model of the new provider
                                const first = models.models.find(m => m.provider === p)
                                if (first) setSelectedModel(first.name)
                              }}
                              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                                aiProvider === p
                                  ? p === 'claude'
                                    ? 'bg-purple-700 text-purple-100'
                                    : 'bg-blue-700 text-blue-100'
                                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                              }`}
                            >
                              {p === 'claude' ? 'Claude' : 'Ollama'}
                              {models.models.some(m => m.provider === p) && (
                                <span className="ml-1 text-[10px] opacity-70">
                                  ●
                                </span>
                              )}
                            </button>
                          ))
                        }

                        <label className="text-sm text-gray-400">Model:</label>
                        {models.models.filter(m => m.provider === aiProvider).length === 0 ? (
                          <span className="text-sm text-yellow-400">No models for this provider</span>
                        ) : (
                          <select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                          >
                            {models.models
                              .filter(m => m.provider === aiProvider)
                              .map((model) => (
                                <option key={model.name} value={model.name}>
                                  {model.displayName || model.name}
                                  {model.name === models.recommended?.model ? ' ★' : ''}
                                </option>
                              ))}
                          </select>
                        )}

                        <button
                          onClick={fetchModels}
                          className="p-1.5 hover:bg-gray-700 rounded transition-colors ml-auto"
                          title="Refresh providers"
                        >
                          <RefreshCw className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Chat Messages */}
                  <div className="flex-1 overflow-auto p-4 space-y-4">
                    {messages.length === 0 ? (
                      <div className="text-gray-500 text-center py-8">
                        <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>Ask the agent about {selectedProject.name}</p>
                        <p className="text-sm mt-2">
                          Try: "What errors are in the logs?" or "Why might Kafka be failing?"
                        </p>
                      </div>
                    ) : (
                      messages.map((msg, i) => (
                        <div
                          key={i}
                          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] px-4 py-2 rounded-lg ${
                              msg.role === 'user'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-800 text-gray-100'
                            }`}
                          >
                            {msg.role === 'user' ? (
                              <span>{msg.content}</span>
                            ) : (
                              <div className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-headings:my-2 prose-ul:my-2 prose-ol:my-2 prose-pre:my-2 prose-pre:bg-gray-900 prose-pre:rounded-lg prose-code:bg-gray-900 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {msg.content}
                                </ReactMarkdown>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                    {agentLoading && (
                      <div className="flex justify-start">
                        <div className="bg-gray-800 px-4 py-2 rounded-lg">
                          <Loader2 className="w-5 h-5 animate-spin" />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Chat Input */}
                  <form onSubmit={handleSendMessage} className="border-t border-gray-800 p-4">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask the agent..."
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                      />
                      <button
                        type="submit"
                        disabled={!input.trim() || agentLoading}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 px-4 py-2 rounded-lg transition-colors"
                      >
                        <Send className="w-5 h-5" />
                      </button>
                    </div>
                  </form>
                </div>
              ) : activeTab === 'metrics' ? (
                <div className="flex-1 flex flex-col">
                  {/* Time Window Selector */}
                  <div className="border-b border-gray-800 px-4 py-3 flex items-center gap-3">
                    <span className="text-sm text-gray-400">Time Range:</span>
                    <div className="flex gap-1">
                      {TIME_WINDOWS.map((tw) => (
                        <button
                          key={tw.label}
                          onClick={() => setTimeWindow(tw)}
                          className={`px-3 py-1 text-sm rounded transition-colors ${
                            timeWindow.value === tw.value
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          {tw.label}
                        </button>
                      ))}
                    </div>
                    <span className="text-xs text-gray-500 ml-auto">
                      {metricsHistory.timestamps.length} data points
                    </span>
                  </div>

                  <div className="flex-1 overflow-auto p-4">
                    {!metricsLoaded ? (
                      <div className="text-gray-500 text-center py-8">
                        <Loader2 className="w-12 h-12 mx-auto mb-3 opacity-50 animate-spin" />
                        <p>Loading metrics...</p>
                      </div>
                    ) : Object.keys(metricsHistory.containers).length === 0 ? (
                      <div className="text-gray-500 text-center py-8">
                        <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>No containers running</p>
                        <p className="text-sm mt-2">Start the project to see metrics</p>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {/* Active Alerts */}
                        {activeAlerts.length > 0 && (
                          <div className="bg-gray-800 rounded-lg p-4 border-l-4 border-red-500">
                            <div className="flex items-center justify-between mb-3">
                              <h3 className="text-lg font-medium flex items-center gap-2">
                                <AlertCircle className="w-5 h-5 text-red-400" />
                                Active Alerts ({activeAlerts.length})
                              </h3>
                              <button
                                onClick={acknowledgeAllAlerts}
                                className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors"
                              >
                                Acknowledge All
                              </button>
                            </div>
                            <div className="space-y-2">
                              {activeAlerts.map((alert) => (
                                <div
                                  key={alert.id}
                                  className={`p-3 rounded-lg ${
                                    alert.severity === 'critical'
                                      ? 'bg-red-500/20 border border-red-500/50'
                                      : 'bg-yellow-500/20 border border-yellow-500/50'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-xs px-2 py-0.5 rounded ${
                                        alert.severity === 'critical' ? 'bg-red-600' : 'bg-yellow-600'
                                      }`}>
                                        {alert.severity.toUpperCase()}
                                      </span>
                                      <span className="font-medium">{alert.name}</span>
                                      {alert.container && (
                                        <span className="text-sm text-gray-400">[{alert.container}]</span>
                                      )}
                                    </div>
                                    <span className="text-sm text-gray-400">
                                      {new Date(alert.triggeredAt).toLocaleTimeString()}
                                    </span>
                                  </div>
                                  <div className="text-sm text-gray-300 mt-1">
                                    {alert.metric}: {alert.value.toFixed(2)} (threshold: {alert.threshold})
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {Object.entries(metricsHistory.containers).map(([containerName, data]) => (
                          <div key={containerName} className="bg-gray-800 rounded-lg p-4">
                            <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                              <HardDrive className="w-5 h-5 text-blue-400" />
                              {containerName}
                            </h3>

                            <div className="grid grid-cols-2 gap-6">
                              <TimeSeriesChart
                                data={data.cpu}
                                timestamps={metricsHistory.timestamps}
                                color="#3b82f6"
                                maxValue={100}
                                label="CPU Usage"
                                unit="%"
                                windowSeconds={timeWindow.value}
                              />
                              <TimeSeriesChart
                                data={data.memory}
                                timestamps={metricsHistory.timestamps}
                                color="#22c55e"
                                maxValue={100}
                                label="Memory Usage"
                                unit="%"
                                windowSeconds={timeWindow.value}
                              />
                            </div>
                          </div>
                        ))}

                        {/* HTTP Request Metrics */}
                        <div className="bg-gray-800 rounded-lg p-4">
                          <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                            <Network className="w-5 h-5 text-purple-400" />
                            HTTP Requests
                          </h3>

                          {metricsHistory.http.requestsPerSecond.length === 0 ? (
                            <p className="text-sm text-gray-500">
                              No HTTP metrics available. Metrics are collected from Spring Boot Actuator on port 8080.
                            </p>
                          ) : (
                            <div className="space-y-6">
                              <div className="grid grid-cols-2 gap-6">
                                <TimeSeriesChart
                                  data={metricsHistory.http.requestsPerSecond}
                                  timestamps={metricsHistory.timestamps}
                                  color="#a855f7"
                                  label="Requests/sec"
                                  unit=""
                                  windowSeconds={timeWindow.value}
                                />
                                <TimeSeriesChart
                                  data={metricsHistory.http.errorRate}
                                  timestamps={metricsHistory.timestamps}
                                  color="#ef4444"
                                  label="Error Rate"
                                  unit="%"
                                  maxValue={100}
                                  windowSeconds={timeWindow.value}
                                />
                              </div>
                              <div className="grid grid-cols-3 gap-6">
                                <TimeSeriesChart
                                  data={metricsHistory.http.p50Latency}
                                  timestamps={metricsHistory.timestamps}
                                  color="#22c55e"
                                  label="p50 Latency"
                                  unit="ms"
                                  windowSeconds={timeWindow.value}
                                />
                                <TimeSeriesChart
                                  data={metricsHistory.http.p95Latency}
                                  timestamps={metricsHistory.timestamps}
                                  color="#eab308"
                                  label="p95 Latency"
                                  unit="ms"
                                  windowSeconds={timeWindow.value}
                                />
                                <TimeSeriesChart
                                  data={metricsHistory.http.p99Latency}
                                  timestamps={metricsHistory.timestamps}
                                  color="#f97316"
                                  label="p99 Latency"
                                  unit="ms"
                                  windowSeconds={timeWindow.value}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : activeTab === 'plugins' ? (
                <div className="flex-1 overflow-auto p-6">
                  {pluginStatuses.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                      <Puzzle className="w-12 h-12 mb-4 opacity-30" />
                      <p className="text-lg font-medium mb-1">No plugins active</p>
                      <p className="text-sm text-gray-600">Start the project with <code className="bg-gray-800 px-1 rounded text-gray-400">--plugins ai-pipeline</code> to enable plugins</p>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {/* User-configured plugins */}
                      {pluginStatuses.filter(p => !p.isDataPlatform).length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <Puzzle className="w-4 h-4" />
                            Active Plugins
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {pluginStatuses.filter(p => !p.isDataPlatform).map(plugin => (
                              <PluginCard key={plugin.key} plugin={plugin} />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Data platform services */}
                      {pluginStatuses.filter(p => p.isDataPlatform).length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <Database className="w-4 h-4" />
                            Data Platform
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {pluginStatuses.filter(p => p.isDataPlatform).map(plugin => (
                              <PluginCard key={plugin.key} plugin={plugin} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : activeTab === 'pipeline' ? (
                <div className="flex-1 overflow-auto p-6">
                  {(pipelineData?.lastRun || pipelineData?.jenkinsUrl) ? (
                    <div className="space-y-6">
                      {/* Stage Visualization */}
                      <div className="bg-gray-800 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-gray-300 mb-4">Pipeline Stages</h3>
                        <div className="flex items-center gap-2 overflow-x-auto">
                          {(pipelineData.lastRun?.stages && pipelineData.lastRun.stages.length > 0
                            ? pipelineData.lastRun.stages
                            : [
                                { name: 'Build', status: 'pending' as const },
                                { name: 'Test', status: 'pending' as const },
                                { name: 'Containerize', status: 'pending' as const },
                                { name: 'Scan', status: 'pending' as const },
                                { name: 'Deploy', status: 'pending' as const },
                              ]
                          ).map((stage, i, arr) => (
                            <div key={stage.name} className="flex items-center gap-2">
                              <div className={`border-2 rounded-lg px-4 py-3 min-w-[120px] text-center ${pipelineStageBorder(stage.status)}`}>
                                <div className="text-sm font-medium">{stage.name}</div>
                                <div className="text-xs text-gray-400 mt-1 capitalize">{stage.status}</div>
                              </div>
                              {i < arr.length - 1 && <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Last Run Info */}
                      {pipelineData.lastRun ? (
                        <div className="bg-gray-800 rounded-lg p-4">
                          <h3 className="text-sm font-semibold text-gray-300 mb-3">Last Run</h3>
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <div className="text-xs text-gray-500">Status</div>
                              <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium ${
                                pipelineData.lastRun.status === 'success' ? 'bg-green-900 text-green-300' :
                                pipelineData.lastRun.status === 'failure' ? 'bg-red-900 text-red-300' :
                                pipelineData.lastRun.status === 'running' ? 'bg-blue-900 text-blue-300' :
                                'bg-gray-700 text-gray-400'
                              }`}>
                                {pipelineData.lastRun.status}
                              </span>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">Duration</div>
                              <div className="text-sm mt-1">{pipelineData.lastRun.duration ? `${pipelineData.lastRun.duration}s` : '-'}</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">Timestamp</div>
                              <div className="text-sm mt-1">{pipelineData.lastRun.timestamp ? new Date(pipelineData.lastRun.timestamp).toLocaleString() : '-'}</div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-gray-800 rounded-lg p-4 text-center text-gray-500 text-sm">
                          No builds yet — run the pipeline to see results
                        </div>
                      )}

                      {/* Run Pipeline */}
                      <div className="bg-gray-800 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-gray-300 mb-3">Run Pipeline</h3>
                        <div className="flex flex-wrap items-center gap-4 mb-4">
                          <label className="flex items-center gap-2 text-sm text-gray-300">
                            <input type="checkbox" checked={pipelineOptions.push} onChange={(e) => setPipelineOptions(p => ({ ...p, push: e.target.checked }))} className="rounded" />
                            Push image
                          </label>
                          <label className="flex items-center gap-2 text-sm text-gray-300">
                            <input type="checkbox" checked={pipelineOptions.skipTests} onChange={(e) => setPipelineOptions(p => ({ ...p, skipTests: e.target.checked }))} className="rounded" />
                            Skip tests
                          </label>
                          <label className="flex items-center gap-2 text-sm text-gray-300">
                            <input type="checkbox" checked={pipelineOptions.skipScan} onChange={(e) => setPipelineOptions(p => ({ ...p, skipScan: e.target.checked }))} className="rounded" />
                            Skip scan
                          </label>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={runPipeline}
                            disabled={pipelineRunning}
                            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
                          >
                            {pipelineRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                            {pipelineRunning ? 'Running...' : 'Run Pipeline'}
                          </button>
                          {pipelineData?.jenkinsUrl && (
                            <a href={pipelineData.jenkinsUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:underline flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" /> Jenkins
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-500 min-h-[300px]">
                      <div className="text-center">
                        <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>No Jenkinsfile found</p>
                        <button
                          onClick={runPipeline}
                          disabled={pipelineRunning}
                          className="mt-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 mx-auto"
                        >
                          {pipelineRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                          {pipelineRunning ? 'Running...' : 'Run Pipeline'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : activeTab === 'environments' ? (
                <div className="flex-1 overflow-auto p-6">
                  {environments.length > 0 ? (
                    <div className="bg-gray-800 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-700 text-left text-gray-400">
                            <th className="px-4 py-3">Environment</th>
                            <th className="px-4 py-3">Version</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Health</th>
                            <th className="px-4 py-3">Replicas</th>
                            <th className="px-4 py-3">Last Deployed</th>
                            <th className="px-4 py-3">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {environments.map((env) => (
                            <tr key={env.name} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                              <td className="px-4 py-3 font-medium">{env.name}</td>
                              <td className="px-4 py-3 font-mono text-xs">{env.version}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${envStatusBadge(env.status)}`}>
                                  {env.status}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${envHealthBadge(env.health)}`}>
                                  {env.health}
                                </span>
                              </td>
                              <td className="px-4 py-3">{env.replicas}</td>
                              <td className="px-4 py-3 text-gray-400">{env.lastDeployed ? new Date(env.lastDeployed).toLocaleString() : '-'}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleDeploy(env.name)}
                                    disabled={deployingEnv === env.name}
                                    className="text-blue-400 hover:text-blue-300 disabled:text-gray-600 text-xs flex items-center gap-1"
                                  >
                                    {deployingEnv === env.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpCircle className="w-3 h-3" />}
                                    Deploy
                                  </button>
                                  <button
                                    onClick={() => handleRollback(env.name)}
                                    disabled={rollingBackEnv === env.name}
                                    className="text-yellow-400 hover:text-yellow-300 disabled:text-gray-600 text-xs flex items-center gap-1"
                                  >
                                    {rollingBackEnv === env.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                                    Rollback
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-500 min-h-[300px]">
                      <div className="text-center">
                        <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>No environments found</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : activeTab === 'deployments' ? (
                <div className="flex-1 overflow-auto p-6 space-y-4">
                  {deployments.length === 0 ? (
                    <div className="flex items-center justify-center min-h-[200px] text-gray-500 text-sm">
                      No deployments recorded yet
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {deployments.map((d: any) => {
                        const shortSha = d.gitSha ? d.gitSha.slice(0, 7) : 'unknown'
                        const statusColor =
                          d.status === 'success' ? 'bg-green-900 text-green-300' :
                          d.status === 'failed' ? 'bg-red-900 text-red-300' :
                          'bg-blue-900 text-blue-300'
                        const hasDelta = d.latencyDelta !== undefined && d.latencyDelta !== null
                        const deltaColor = d.regression
                          ? 'bg-red-900 text-red-300'
                          : hasDelta && d.latencyDelta < 0
                            ? 'bg-green-900 text-green-300'
                            : 'bg-gray-700 text-gray-400'
                        return (
                          <div
                            key={d.id}
                            className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-2"
                          >
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="font-mono text-sm text-blue-400">{shortSha}</span>
                              <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusColor}`}>
                                {d.status}
                              </span>
                              <span className="text-xs text-gray-500 ml-auto">
                                {new Date(d.timestamp).toLocaleString()}
                              </span>
                            </div>
                            {hasDelta && (
                              <div className="flex items-center gap-2">
                                <span className={`text-xs px-2 py-0.5 rounded font-medium ${deltaColor}`}>
                                  {d.latencyDelta > 0 ? '+' : ''}{d.latencyDelta.toFixed(1)}ms latency delta
                                  {d.regression ? ' ⚠ regression' : ''}
                                </span>
                                {d.latencyBefore !== undefined && (
                                  <span className="text-xs text-gray-500">
                                    P95 before: {d.latencyBefore.toFixed(1)}ms → after: {d.latencyAfter?.toFixed(1)}ms
                                  </span>
                                )}
                              </div>
                            )}
                            {d.regression && d.jaegerTraceUrl && (
                              <div>
                                <a
                                  href={d.jaegerTraceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors w-fit"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  View Traces
                                </a>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : activeTab === 'settings' ? (
                <div className="flex-1 overflow-auto p-6 space-y-6">
                  {settingsLoading ? (
                    <div className="flex items-center justify-center min-h-[200px]">
                      <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
                    </div>
                  ) : (
                    <>
                      {/* Alert Thresholds */}
                      <div className="bg-gray-800 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-sm font-semibold text-gray-300">Alert Thresholds</h3>
                          <button
                            onClick={() => setNewThreshold({ name: '', metric: 'cpu', operator: '>', value: 80, severity: 'warning', enabled: true })}
                            className="text-xs bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                          >
                            <Plus className="w-3 h-3" /> Add Threshold
                          </button>
                        </div>
                        <div className="space-y-2">
                          {alertThresholds.map((t) => (
                            <div key={t.id} className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-3">
                              {editingThreshold === t.id ? (
                                <div className="flex items-center gap-3 flex-1">
                                  <input
                                    value={editThresholdValues.value ?? t.value}
                                    onChange={(e) => setEditThresholdValues(v => ({ ...v, value: Number(e.target.value) }))}
                                    type="number"
                                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1 w-20 text-sm"
                                  />
                                  <select
                                    value={editThresholdValues.operator ?? t.operator}
                                    onChange={(e) => setEditThresholdValues(v => ({ ...v, operator: e.target.value }))}
                                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
                                  >
                                    <option value=">">{'>'}</option>
                                    <option value="<">{'<'}</option>
                                    <option value=">=">{'>='}</option>
                                    <option value="<=">{'<='}</option>
                                  </select>
                                  <select
                                    value={editThresholdValues.severity ?? t.severity}
                                    onChange={(e) => setEditThresholdValues(v => ({ ...v, severity: e.target.value as 'warning' | 'critical' }))}
                                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
                                  >
                                    <option value="warning">Warning</option>
                                    <option value="critical">Critical</option>
                                  </select>
                                  <button
                                    onClick={() => saveAlertThreshold({ ...t, ...editThresholdValues } as AlertThreshold)}
                                    className="text-green-400 hover:text-green-300"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => { setEditingThreshold(null); setEditThresholdValues({}) }}
                                    className="text-gray-400 hover:text-gray-300"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm font-medium">{t.name}</span>
                                    <span className="text-xs text-gray-500">{t.metric} {t.operator} {t.value}</span>
                                    <span className={`px-2 py-0.5 rounded text-xs ${t.severity === 'critical' ? 'bg-red-900 text-red-300' : 'bg-yellow-900 text-yellow-300'}`}>
                                      {t.severity}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => toggleThreshold(t)} className="text-gray-400 hover:text-gray-200" title={t.enabled ? 'Disable' : 'Enable'}>
                                      {t.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                    </button>
                                    <button
                                      onClick={() => { setEditingThreshold(t.id); setEditThresholdValues({}) }}
                                      className="text-gray-400 hover:text-blue-400"
                                    >
                                      <SettingsIcon className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => deleteAlertThreshold(t.id)} className="text-gray-400 hover:text-red-400">
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                          {newThreshold && (
                            <div className="flex items-center gap-3 bg-gray-900 rounded-lg px-4 py-3">
                              <input
                                value={newThreshold.name || ''}
                                onChange={(e) => setNewThreshold(t => ({ ...t, name: e.target.value }))}
                                placeholder="Name"
                                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm flex-1"
                              />
                              <select
                                value={newThreshold.metric || 'cpu'}
                                onChange={(e) => setNewThreshold(t => ({ ...t, metric: e.target.value }))}
                                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
                              >
                                <option value="cpu">CPU</option>
                                <option value="memory">Memory</option>
                                <option value="errorRate">Error Rate</option>
                                <option value="responseTime">Response Time</option>
                              </select>
                              <select
                                value={newThreshold.operator || '>'}
                                onChange={(e) => setNewThreshold(t => ({ ...t, operator: e.target.value }))}
                                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
                              >
                                <option value=">">{'>'}</option>
                                <option value="<">{'<'}</option>
                                <option value=">=">{'>='}</option>
                                <option value="<=">{'<='}</option>
                              </select>
                              <input
                                value={newThreshold.value ?? 80}
                                onChange={(e) => setNewThreshold(t => ({ ...t, value: Number(e.target.value) }))}
                                type="number"
                                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 w-20 text-sm"
                              />
                              <button
                                onClick={() => addAlertThreshold(newThreshold)}
                                className="text-green-400 hover:text-green-300"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setNewThreshold(null)}
                                className="text-gray-400 hover:text-gray-300"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                          {alertThresholds.length === 0 && !newThreshold && (
                            <div className="text-center text-gray-500 py-4 text-sm">No thresholds configured</div>
                          )}
                        </div>
                      </div>

                      {/* Log Management */}
                      <div className="bg-gray-800 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-gray-300 mb-4">Log Management</h3>
                        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                          <div>
                            <span className="text-gray-500">Total Size:</span>{' '}
                            <span>{(logStats.totalSize / 1024).toFixed(1)} KB</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Files:</span>{' '}
                            <span>{logStats.fileCount}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Max File Size (MB)</label>
                            <input
                              type="number"
                              value={logConfig.maxFileSize}
                              onChange={(e) => setLogConfig(c => ({ ...c, maxFileSize: Number(e.target.value) }))}
                              className="bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Retention (days)</label>
                            <input
                              type="number"
                              value={logConfig.maxRetentionDays}
                              onChange={(e) => setLogConfig(c => ({ ...c, maxRetentionDays: Number(e.target.value) }))}
                              className="bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Max Files</label>
                            <input
                              type="number"
                              value={logConfig.maxFiles}
                              onChange={(e) => setLogConfig(c => ({ ...c, maxFiles: Number(e.target.value) }))}
                              className="bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm w-full"
                            />
                          </div>
                          <div className="flex items-end">
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                              <input
                                type="checkbox"
                                checked={logConfig.persist}
                                onChange={(e) => setLogConfig(c => ({ ...c, persist: e.target.checked }))}
                                className="rounded"
                              />
                              Persist logs
                            </label>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={saveLogRetentionConfig} className="bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm transition-colors">
                            Save Config
                          </button>
                          <button onClick={handleLogRotate} className="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" /> Rotate Logs
                          </button>
                          <button onClick={handleClearLogs} className="bg-red-900 hover:bg-red-800 text-red-300 px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1">
                            <Trash2 className="w-3 h-3" /> Clear All Logs
                          </button>
                        </div>
                      </div>

                      {/* Metrics Management */}
                      <div className="bg-gray-800 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-gray-300 mb-4">Metrics Management</h3>
                        <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                          <div>
                            <span className="text-gray-500">Total Size:</span>{' '}
                            <span>{(metricsStorage.totalSize / 1024).toFixed(1)} KB</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Data Points:</span>{' '}
                            <span>{metricsStorage.dataPoints}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Files:</span>{' '}
                            <span>{metricsStorage.fileCount}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => handleExportMetrics('json')} className="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1">
                            <Download className="w-3 h-3" /> Export JSON
                          </button>
                          <button onClick={() => handleExportMetrics('csv')} className="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1">
                            <Download className="w-3 h-3" /> Export CSV
                          </button>
                          <button onClick={handleClearMetrics} className="bg-red-900 hover:bg-red-800 text-red-300 px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1">
                            <Trash2 className="w-3 h-3" /> Clear All Metrics
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <FolderOpen className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg">Select a project to get started</p>
                <p className="text-sm mt-2">or create a new one with the button above</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Create New Project</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Project Name</label>
                <input
                  type="text"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  placeholder="my-awesome-app"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Project Type</label>
                <select
                  value={newProject.type}
                  onChange={(e) => setNewProject({ ...newProject, type: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                >
                  {templates?.types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {newProject.type !== 'frontend' && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Backend</label>
                  <select
                    value={newProject.backend}
                    onChange={(e) => setNewProject({ ...newProject, backend: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  >
                    {templates?.backends.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {newProject.type !== 'backend' && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Frontend</label>
                  <select
                    value={newProject.frontend}
                    onChange={(e) => setNewProject({ ...newProject, frontend: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  >
                    {templates?.frontends.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm text-gray-400 mb-1">Database</label>
                <select
                  value={newProject.database}
                  onChange={(e) => setNewProject({ ...newProject, database: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                >
                  {templates?.databases.map((d) => (
                    <option key={d} value={d}>
                      {d === 'none' ? 'None' : d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newProject.name.trim() || creating}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Error Modal */}
      {errorModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-6 h-6 text-red-400" />
                <h2 className="text-xl font-semibold text-red-400">{errorModal.title}</h2>
              </div>
              <button
                onClick={() => setErrorModal(null)}
                className="p-1 hover:bg-gray-700 rounded transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="relative">
              <pre className="bg-gray-900 rounded-lg p-4 text-sm text-gray-300 overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                {errorModal.message}
              </pre>
              <button
                onClick={() => copyToClipboard(errorModal.message)}
                className="absolute top-2 right-2 p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors flex items-center gap-2"
                title="Copy to clipboard"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-green-400">Copied!</span>
                  </>
                ) : (
                  <Copy className="w-4 h-4 text-gray-400" />
                )}
              </button>
            </div>

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setErrorModal(null)}
                className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
