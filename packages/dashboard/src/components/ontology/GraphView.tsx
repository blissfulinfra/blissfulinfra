import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Save, RefreshCw, Loader2 } from 'lucide-react'
import { getConfig } from '../../config'
import { OntologyNodeView } from './OntologyNodeView'
import { NodeDetailPanel } from './NodeDetailPanel'
import { EdgeEditor } from './EdgeEditor'
import { EDGE_TYPE_COLORS, type ClientOntology, type OntologyEdge, type OntologyNode } from './types'

interface Props {
  clientName: string
  onClose: () => void
}

const nodeTypes = { ontology: OntologyNodeView }

function toFlowNodes(nodes: OntologyNode[]): Node[] {
  return nodes.map(n => ({
    id: n.id,
    type: 'ontology',
    position: n.position,
    data: n as unknown as Record<string, unknown>,
  }))
}

function toFlowEdges(edges: OntologyEdge[]): Edge[] {
  return edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    style: { stroke: EDGE_TYPE_COLORS[e.type], strokeWidth: e.wired ? 2.5 : 1.5 },
    animated: !e.wired && e.type !== 'custom',
    labelStyle: { fill: '#e5e7eb', fontSize: 11, fontFamily: 'ui-monospace, monospace' },
    labelBgStyle: { fill: '#1f2937' },
  }))
}

function GraphInner({ clientName, onClose }: Props) {
  const [graph, setGraph] = useState<ClientOntology | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const apiBase = getConfig().apiBase
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/ontology/${clientName}`)
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      const data = await res.json() as ClientOntology
      setGraph(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [clientName])

  const scheduleSave = useCallback((next: ClientOntology) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        await fetch(`${apiBase}/ontology/${clientName}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        })
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setSaving(false)
      }
    }, 500)
  }, [apiBase, clientName])

  const flowNodes = useMemo(() => graph ? toFlowNodes(graph.nodes) : [], [graph])
  const flowEdges = useMemo(() => graph ? toFlowEdges(graph.edges) : [], [graph])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setGraph(prev => {
      if (!prev) return prev
      const updated = applyNodeChanges(changes, toFlowNodes(prev.nodes))
      const nextNodes: OntologyNode[] = prev.nodes.map(n => {
        const flow = updated.find(u => u.id === n.id)
        return flow ? { ...n, position: flow.position } : n
      })
      const next = { ...prev, nodes: nextNodes }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setGraph(prev => {
      if (!prev) return prev
      const updated = applyEdgeChanges(changes, toFlowEdges(prev.edges))
      const nextEdges = prev.edges.filter(e => updated.find(u => u.id === e.id))
      const next = { ...prev, edges: nextEdges }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    setGraph(prev => {
      if (!prev) return prev
      const id = `${connection.source}__${connection.target}__${Date.now()}`
      const newEdge: OntologyEdge = {
        id,
        source: connection.source!,
        target: connection.target!,
        type: 'http',
        wired: false,
      }
      const next = { ...prev, edges: [...prev.edges, newEdge] }
      scheduleSave(next)
      setSelectedEdgeId(id)
      return next
    })
    // Suppress unused — addEdge is the canonical helper but we work in domain space
    void addEdge
  }, [scheduleSave])

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => {
    setSelectedNodeId(node.id)
    setSelectedEdgeId(null)
  }, [])

  const onEdgeClick: EdgeMouseHandler = useCallback((_e, edge) => {
    setSelectedEdgeId(edge.id)
    setSelectedNodeId(null)
  }, [])

  const selectedNode = graph?.nodes.find(n => n.id === selectedNodeId) ?? null
  const selectedEdge = graph?.edges.find(e => e.id === selectedEdgeId) ?? null

  function updateEdge(updated: OntologyEdge) {
    setGraph(prev => {
      if (!prev) return prev
      const next = { ...prev, edges: prev.edges.map(e => e.id === updated.id ? updated : e) }
      scheduleSave(next)
      return next
    })
  }

  function deleteEdge(id: string) {
    setGraph(prev => {
      if (!prev) return prev
      const next = { ...prev, edges: prev.edges.filter(e => e.id !== id) }
      scheduleSave(next)
      return next
    })
    setSelectedEdgeId(null)
  }

  return (
    <div className="fixed inset-0 bg-gray-950 z-30 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-100">System Topology</span>
          <span className="text-xs text-blue-300 bg-blue-900/40 border border-blue-700 px-2 py-0.5 rounded font-mono">{clientName}</span>
          {saving && <span className="text-xs text-gray-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> saving</span>}
          {error && <span className="text-xs text-red-300">{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} className="p-2 hover:bg-gray-800 rounded" title="Refresh">
            <RefreshCw className="w-4 h-4 text-gray-400" />
          </button>
          <button onClick={onClose} className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded">
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#374151" />
            <Controls className="!bg-gray-800 !border-gray-700" />
            <MiniMap className="!bg-gray-900 !border-gray-700" maskColor="rgba(0,0,0,0.6)" nodeColor="#60a5fa" />
          </ReactFlow>
        )}

        {selectedNode && (
          <NodeDetailPanel
            clientName={clientName}
            node={selectedNode}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
        {selectedEdge && (
          <EdgeEditor
            clientName={clientName}
            edge={selectedEdge}
            onClose={() => setSelectedEdgeId(null)}
            onChange={updateEdge}
            onDelete={() => deleteEdge(selectedEdge.id)}
          />
        )}
      </div>
    </div>
  )
}

export function GraphView(props: Props) {
  // Keep the unused-imports-friendly guard explicit
  void Save
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  )
}
