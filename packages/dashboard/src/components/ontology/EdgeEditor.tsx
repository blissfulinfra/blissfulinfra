import { useState } from 'react'
import { X, Trash2, Zap, Loader2 } from 'lucide-react'
import { getConfig } from '../../config'
import type { OntologyEdge, OntologyEdgeType } from './types'

interface Props {
  clientName: string
  edge: OntologyEdge
  onClose: () => void
  onChange: (edge: OntologyEdge) => void
  onDelete: () => void
}

const EDGE_TYPES: OntologyEdgeType[] = ['http', 'kafka', 'database', 'custom']

export function EdgeEditor({ clientName, edge, onClose, onChange, onDelete }: Props) {
  const [wiring, setWiring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const apiBase = getConfig().apiBase

  async function promote() {
    setWiring(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/ontology/${clientName}/edges/${encodeURIComponent(edge.id)}/wire`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      const updated = await res.json() as OntologyEdge
      onChange(updated)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setWiring(false)
    }
  }

  return (
    <div className="fixed top-0 right-0 h-full w-[420px] bg-gray-900 border-l border-gray-800 z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div>
          <div className="text-sm font-semibold text-gray-100">Connection</div>
          <div className="text-xs text-gray-500 font-mono">{edge.source} → {edge.target}</div>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded">
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      <div className="p-4 space-y-4 text-sm flex-1">
        <Field label="Type">
          <select
            value={edge.type}
            onChange={e => onChange({ ...edge, type: e.target.value as OntologyEdgeType })}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm"
          >
            {EDGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>

        <Field label="Label">
          <input
            value={edge.label ?? ''}
            onChange={e => onChange({ ...edge, label: e.target.value })}
            placeholder="e.g. publishes orders.created"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono"
          />
        </Field>

        {edge.type === 'custom' && (
          <>
            <Field label="Env Key">
              <input
                value={edge.properties?.envKey ?? ''}
                onChange={e => onChange({ ...edge, properties: { ...(edge.properties ?? {}), envKey: e.target.value } })}
                placeholder="e.g. API_TOKEN"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono"
              />
            </Field>
            <Field label="Env Value">
              <input
                value={edge.properties?.envValue ?? ''}
                onChange={e => onChange({ ...edge, properties: { ...(edge.properties ?? {}), envValue: e.target.value } })}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono"
              />
            </Field>
          </>
        )}

        <div className="pt-2 border-t border-gray-800">
          <div className="text-xs text-gray-500 mb-2">Status</div>
          {edge.wired ? (
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <Zap className="w-4 h-4 fill-current" />
              Wired into compose
            </div>
          ) : (
            <div className="text-sm text-gray-400">Visual only · not yet wired into compose</div>
          )}
        </div>

        {error && <div className="text-xs text-red-300 bg-red-900/30 border border-red-800 rounded p-2">{error}</div>}
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-800">
        <button
          onClick={onDelete}
          className="flex items-center gap-2 px-3 py-1.5 text-red-400 hover:bg-red-900/30 rounded text-sm"
        >
          <Trash2 className="w-3 h-3" />
          Delete
        </button>
        <button
          onClick={promote}
          disabled={edge.wired || wiring || !edge.source.startsWith('service:')}
          className="flex items-center gap-2 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
          title={!edge.source.startsWith('service:') ? 'Wiring requires a service as the source' : ''}
        >
          {wiring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          {edge.wired ? 'Wired' : 'Promote to wiring'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  )
}
