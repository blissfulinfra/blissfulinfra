import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, RefreshCw } from 'lucide-react'
import { browserAiAvailability, browserAiChatStream } from '../utils/browserAi'

interface Props {
  projectName: string | null
  withTenant: (path: string) => string
  apiBase: string
}

interface Finding {
  ts: number
  text: string
}

const POLL_MS = 60_000

// Deliberately tight system prompt: the model errs toward false-positives
// without explicit guardrails. "All green" is a valid (and frequent) answer.
const SYSTEM_PROMPT = `You watch a developer's local dev stack via blissful-infra. Surface ONLY actual anomalies a developer would want to know about: failed deploys, crashed services, error spikes, alerts firing, missing components.

Rules:
- Be terse. One short line per finding. Bullet points.
- Prefix each finding with severity: 🔴 critical, 🟡 worth checking, 🟢 ok.
- If everything looks normal, respond exactly: all green
- Do NOT speculate. Only report what is in the provided data.
- Ignore startup banners, Kafka rebalances, normal log noise.
- Do NOT explain what blissful-infra is or restate the input.`

export function Watcher({ projectName, withTenant, apiBase }: Props) {
  const [available, setAvailable] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [finding, setFinding] = useState<Finding | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    browserAiAvailability().then(a => setAvailable(a === 'available' || a === 'downloadable'))
  }, [])

  const gatherContext = useCallback(async (): Promise<string> => {
    if (!projectName) return ''
    const lines: string[] = []
    try {
      const r = await fetch(withTenant(`${apiBase}/projects/${projectName}/health`))
      if (r.ok) {
        const data = await r.json() as { services?: Array<{ name: string; status: string }> }
        if (data.services?.length) {
          lines.push(`HEALTH: ${data.services.map(s => `${s.name}=${s.status}`).join(', ')}`)
        }
      }
    } catch { /* silent */ }
    try {
      const r = await fetch(withTenant(`${apiBase}/projects/${projectName}/alerts`))
      if (r.ok) {
        const data = await r.json() as { triggered?: Array<{ id: string; metric?: string; message?: string }> }
        if (data.triggered?.length) {
          lines.push(`ALERTS: ${data.triggered.map(a => `${a.id} ${a.metric ?? ''} ${a.message ?? ''}`).join('; ')}`)
        }
      }
    } catch { /* silent */ }
    try {
      const params = new URLSearchParams({ level: 'error', limit: '30' })
      const r = await fetch(withTenant(`${apiBase}/projects/${projectName}/logs/loki?${params}`))
      if (r.ok) {
        const data = await r.json() as { logs?: Array<{ service: string; message: string }> }
        if (data.logs?.length) {
          const trimmed = data.logs.slice(0, 20).map(l => `[${l.service}] ${l.message.slice(0, 200)}`).join('\n')
          lines.push(`RECENT ERRORS:\n${trimmed}`)
        }
      }
    } catch { /* silent */ }
    return lines.join('\n\n')
  }, [projectName, withTenant, apiBase])

  const check = useCallback(async () => {
    if (!available || !projectName) return
    setChecking(true)
    try {
      const context = await gatherContext()
      const prompt = context
        ? `Current state of project "${projectName}":\n\n${context}\n\nWhat should the developer know?`
        : `Project "${projectName}" — no data available. Reply "all green".`
      let acc = ''
      for await (const chunk of browserAiChatStream(
        [{ role: 'user', content: prompt }],
        SYSTEM_PROMPT,
      )) {
        acc += chunk
      }
      setFinding({ ts: Date.now(), text: acc.trim() || 'all green' })
    } catch (e) {
      // Silently swallow — this is passive. If the model fails for a tick,
      // the next tick gets another chance.
      console.warn('Watcher tick failed:', e)
    } finally {
      setChecking(false)
    }
  }, [available, projectName, gatherContext])

  // Polling loop: runs continuously even when the tab is not active, so the
  // watcher can catch issues in the background and alert the developer.
  useEffect(() => {
    if (!enabled || !available || !projectName) return
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      check()
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [enabled, available, projectName, check])

  // Reset finding when project changes; otherwise the user sees stale info.
  useEffect(() => { setFinding(null) }, [projectName])

  if (!available || !projectName) return null

  return (
    <div className="mb-4 border border-gray-800 rounded-lg bg-gray-900/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Eye className="w-3.5 h-3.5 text-emerald-300" />
          <span className="text-xs font-semibold text-gray-100 uppercase tracking-wider">Watcher</span>
          {finding && (
            <span className="text-[10px] text-gray-500" title={new Date(finding.ts).toLocaleString()}>
              {Math.round((Date.now() - finding.ts) / 1000)}s ago
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={check}
            disabled={checking || !enabled}
            className="p-1 hover:bg-gray-800 rounded disabled:opacity-50"
            title="Check now"
            aria-label="Check now"
          >
            <RefreshCw className={`w-3 h-3 text-gray-400 ${checking ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setEnabled(!enabled)}
            className="p-1 hover:bg-gray-800 rounded"
            title={enabled ? 'Pause watcher' : 'Resume watcher'}
            aria-label={enabled ? 'Pause watcher' : 'Resume watcher'}
          >
            {enabled
              ? <Eye className="w-3 h-3 text-emerald-300" />
              : <EyeOff className="w-3 h-3 text-gray-500" />}
          </button>
        </div>
      </div>
      <div className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed min-h-[1.5em]">
        {finding ? finding.text : checking ? 'checking…' : enabled ? 'standby' : 'paused'}
      </div>
    </div>
  )
}
