import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { X, Trash2, Zap, Loader2, FileText } from 'lucide-react'
import { getConfig } from '../../config'
import type { OntologyEdge, OntologyEdgeType, ContractFormat } from './types'
import { CONTRACT_FORMAT_BY_EDGE_TYPE, DEFAULT_CONTRACT_TEMPLATES } from './types'

interface Props {
  clientName: string
  edge: OntologyEdge
  onClose: () => void
  onChange: (edge: OntologyEdge) => void
  onDelete: () => void
}

const EDGE_TYPES: OntologyEdgeType[] = ['http', 'kafka', 'database', 'custom']
type Tab = 'settings' | 'contract'

function monacoLanguage(format: ContractFormat | null): string {
  if (format === 'openapi' || format === 'avro') return format === 'avro' ? 'json' : 'yaml'
  if (format === 'sql') return 'sql'
  return 'yaml'
}

export function EdgeEditor({ clientName, edge, onClose, onChange, onDelete }: Props) {
  const [tab, setTab] = useState<Tab>('settings')
  const [wiring, setWiring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wireResult, setWireResult] = useState<string | null>(null)
  const apiBase = getConfig().apiBase

  const expectedFormat = CONTRACT_FORMAT_BY_EDGE_TYPE[edge.type]
  const sourceIsService = edge.source.startsWith('service:')
  const hasContract = !!edge.contract?.schema
  const canPromote = sourceIsService && (edge.type === 'custom' || hasContract) && !edge.wired

  function initContract() {
    if (!expectedFormat) return
    onChange({ ...edge, contract: { format: expectedFormat, schema: DEFAULT_CONTRACT_TEMPLATES[expectedFormat] } })
    setTab('contract')
  }

  async function promote() {
    setWiring(true)
    setError(null)
    setWireResult(null)
    try {
      const res = await fetch(`${apiBase}/ontology/${clientName}/edges/${encodeURIComponent(edge.id)}/wire`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      const data = await res.json() as OntologyEdge & { codegen?: { written?: string[]; warnings?: string[] } }
      onChange({ ...data, wired: true })
      if (data.codegen?.written?.length) {
        setWireResult(`Wrote ${data.codegen.written.length} file(s): ${data.codegen.written.join(', ')}`)
      } else if (data.codegen?.warnings?.length) {
        setWireResult(data.codegen.warnings.join(' · '))
      } else {
        setWireResult('Env vars + depends_on injected')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setWiring(false)
    }
  }

  return (
    <div className="fixed top-0 right-0 h-full w-[560px] bg-gray-900 border-l border-gray-800 z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div>
          <div className="text-sm font-semibold text-gray-100">Connection</div>
          <div className="text-xs text-gray-500 font-mono">{edge.source} → {edge.target}</div>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded">
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      <div className="flex border-b border-gray-800 text-sm">
        {(['settings', 'contract'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 border-b-2 ${tab === t ? 'border-blue-400 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            {t === 'settings' ? 'Settings' : 'Contract'}
            {t === 'contract' && hasContract && <span className="ml-1 w-1.5 h-1.5 inline-block rounded-full bg-green-400 align-middle" />}
          </button>
        ))}
      </div>

      {tab === 'settings' && (
        <div className="p-4 space-y-4 text-sm flex-1 overflow-auto">
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
              <div className="text-sm text-gray-400">Visual only · not yet wired</div>
            )}
          </div>

          {error && <div className="text-xs text-red-300 bg-red-900/30 border border-red-800 rounded p-2">{error}</div>}
          {wireResult && <div className="text-xs text-green-300 bg-green-900/30 border border-green-800 rounded p-2 font-mono">{wireResult}</div>}
        </div>
      )}

      {tab === 'contract' && (
        <div className="flex-1 flex flex-col min-h-0">
          {!expectedFormat && (
            <div className="p-4 text-sm text-gray-400">
              Custom edges have no schema contract — use the env-key field on the Settings tab.
            </div>
          )}
          {expectedFormat && !hasContract && (
            <div className="p-6 text-center">
              <FileText className="w-10 h-10 mx-auto mb-3 text-gray-500" />
              <div className="text-sm text-gray-300 mb-1">No contract defined yet</div>
              <div className="text-xs text-gray-500 mb-4">A {expectedFormat.toUpperCase()} schema describes the data flowing across this edge.</div>
              <button
                onClick={initContract}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm"
              >
                Start from template
              </button>
            </div>
          )}
          {expectedFormat && hasContract && (
            <>
              <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-800">
                Format: <span className="text-gray-300 font-mono">{edge.contract!.format}</span>
                {edge.wired && <span className="ml-2 text-green-400">· wired</span>}
              </div>
              <div className="flex-1 min-h-0">
                <Editor
                  height="100%"
                  language={monacoLanguage(edge.contract!.format)}
                  theme="vs-dark"
                  value={edge.contract!.schema}
                  onChange={v => onChange({ ...edge, contract: { ...edge.contract!, schema: v ?? '' } })}
                  options={{ minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }}
                />
              </div>
            </>
          )}
        </div>
      )}

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
          disabled={!canPromote || wiring}
          className="flex items-center gap-2 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
          title={
            !sourceIsService ? 'Wiring requires a service as the source' :
            !hasContract && edge.type !== 'custom' ? 'Define a contract first' :
            edge.wired ? 'Already wired' : ''
          }
        >
          {wiring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          {edge.wired ? 'Wired' : 'Wire it up'}
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
