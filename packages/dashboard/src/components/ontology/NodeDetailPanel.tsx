import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { X, Save, Loader2 } from 'lucide-react'
import { getConfig } from '../../config'
import type { OntologyNode, NodeConfigResponse } from './types'
import { NODE_PALETTE } from './types'

interface Props {
  clientName: string
  node: OntologyNode
  onClose: () => void
}

type Tab = 'overview' | 'config'

export function NodeDetailPanel({ clientName, node, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [config, setConfig] = useState<NodeConfigResponse | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const palette = NODE_PALETTE[node.type] ?? NODE_PALETTE.service
  const apiBase = getConfig().apiBase

  useEffect(() => {
    if (tab !== 'config') return
    setLoading(true)
    setError(null)
    fetch(`${apiBase}/ontology/${clientName}/nodes/${encodeURIComponent(node.id)}/config`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
        return r.json() as Promise<NodeConfigResponse>
      })
      .then(data => {
        setConfig(data)
        setDraft(data.content)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [tab, clientName, node.id, apiBase])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/ontology/${clientName}/nodes/${encodeURIComponent(node.id)}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      if (config) setConfig({ ...config, content: draft })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const dirty = config !== null && draft !== config.content

  return (
    <div className="fixed top-0 right-0 h-full w-[560px] bg-gray-900 border-l border-gray-800 z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: palette.color }} />
          <div>
            <div className="text-sm font-semibold text-gray-100 font-mono">{node.label}</div>
            <div className="text-xs text-gray-500">{node.type} · {node.id}</div>
          </div>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded">
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      <div className="flex border-b border-gray-800 text-sm">
        {(['overview', 'config'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 border-b-2 ${tab === t ? 'border-blue-400 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            {t === 'overview' ? 'Overview' : 'Config'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="p-4 space-y-3 text-sm">
          <Row label="ID" value={node.id} mono />
          <Row label="Type" value={node.type} />
          <Row label="Status" value={node.status ?? 'unknown'} />
          {node.port !== undefined && <Row label="Port" value={`localhost:${node.port}`} mono />}
        </div>
      )}

      {tab === 'config' && (
        <div className="flex-1 flex flex-col min-h-0">
          {error && <div className="px-4 py-2 text-xs text-red-300 bg-red-900/30 border-b border-red-800">{error}</div>}
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="px-4 py-2 text-xs text-gray-500 font-mono border-b border-gray-800">{config?.path}</div>
              <div className="flex-1 min-h-0">
                <Editor
                  height="100%"
                  language="yaml"
                  theme="vs-dark"
                  value={draft}
                  onChange={v => setDraft(v ?? '')}
                  options={{ minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }}
                />
              </div>
              <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-gray-800">
                {dirty && <span className="text-xs text-yellow-400">unsaved changes</span>}
                <button
                  onClick={save}
                  disabled={!dirty || saving}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-gray-500 w-20">{label}</span>
      <span className={`text-gray-200 ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}
