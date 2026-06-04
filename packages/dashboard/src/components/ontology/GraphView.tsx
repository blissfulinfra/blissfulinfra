import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { OntologyNodeView } from './OntologyNodeView'
import { EDGE_TYPE_COLORS } from './types'

const nodeTypes = { ontology: OntologyNodeView }

/**
 * Canonical React Flow (xyflow v12) setup, rebuilt from the docs.
 *
 *   https://reactflow.dev/learn
 *   https://reactflow.dev/api-reference/react-flow
 *
 * Deliberately uses ZERO Tailwind classes on or above the ReactFlow element.
 * Tailwind v4's preflight + the project's `*` reset have a history of
 * silently clobbering library-provided structural CSS, so the entire modal
 * sub-tree below the header is plain inline styles. Once this paints, the
 * custom OntologyNodeView gets layered back in.
 */

interface Props {
  clientName: string
  onClose: () => void
}

interface OntologyResponse {
  clientName: string
  nodes: Array<{
    id: string
    type: string
    label: string
    port?: number
    status?: string
    position: { x: number; y: number }
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    type: string
    label?: string
  }>
}

function GraphInner({ clientName, onClose }: Props) {
  const [graph, setGraph] = useState<OntologyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/v1/ontology/${clientName}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<OntologyResponse>
      })
      .then(data => {
        if (cancelled) return
        setGraph(data)
        setNodes(data.nodes.map(n => ({
          id: n.id,
          type: 'ontology',
          position: n.position,
          data: {
            label: n.label,
            type: n.type,
            port: n.port,
            status: n.status,
          },
        })))
        setEdges(data.edges.map(e => {
          const color = EDGE_TYPE_COLORS[e.type as keyof typeof EDGE_TYPE_COLORS] ?? '#a3a3a3'
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label,
            animated: true,
            style: { stroke: color, strokeWidth: 2 },
            labelStyle: { fill: '#e2e8f0', fontSize: 11, fontFamily: 'ui-monospace, monospace' },
            labelBgStyle: { fill: '#1a2236', fillOpacity: 0.9 },
          }
        }))
      })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [clientName])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes(curr => applyNodeChanges(changes, curr)),
    [],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges(curr => applyEdgeChanges(changes, curr)),
    [],
  )

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      flexDirection: 'column',
      background: '#0b0e1a',
    }}>
      <div style={{
        height: 56,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        borderBottom: '1px solid #1a2236',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: '#e2e8f0' }}>System Topology</span>
          <span style={{
            fontSize: 11,
            color: '#90beff',
            background: 'rgba(59,126,244,0.15)',
            border: '1px solid #3b7ef4',
            padding: '2px 6px',
            borderRadius: 3,
            fontFamily: 'monospace',
          }}>{clientName}</span>
          <span style={{ fontSize: 10, color: '#8899b4', fontFamily: 'monospace' }}>
            {loading ? 'fetching…' : error ? `error: ${error}` : `nodes=${graph?.nodes.length ?? 0} edges=${graph?.edges.length ?? 0}`}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: '#111827',
            color: '#e2e8f0',
            padding: '6px 12px',
            borderRadius: 4,
            fontSize: 12,
            border: '1px solid #1a2236',
            cursor: 'pointer',
          }}
        >Close</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1a2236" gap={20} size={1.5} />
          <Controls style={{ background: '#111827', border: '1px solid #1a2236' }} />
          <MiniMap
            style={{ background: '#0b0e1a', border: '1px solid #1a2236' }}
            nodeColor="#3b7ef4"
            maskColor="rgba(0,0,0,0.6)"
          />
        </ReactFlow>
      </div>
    </div>
  )
}

export function GraphView(props: Props) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  )
}
