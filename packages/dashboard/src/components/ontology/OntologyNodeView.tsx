import { Handle, Position } from '@xyflow/react'
import { NODE_PALETTE, type OntologyNode } from './types'

interface Props {
  data: OntologyNode & { selected?: boolean }
}

export function OntologyNodeView({ data }: Props) {
  const palette = NODE_PALETTE[data.type] ?? NODE_PALETTE.service
  const statusColor =
    data.status === 'running' ? '#22c55e'
    : data.status === 'stopped' ? '#71717a'
    : '#facc15'

  return (
    <div
      style={{
        background: palette.bg,
        border: `1px solid ${palette.color}`,
        borderRadius: 6,
        padding: '10px 14px',
        minWidth: 160,
        color: '#e5e7eb',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
        boxShadow: data.selected ? `0 0 0 2px ${palette.color}` : 'none',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: palette.color }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: palette.color, fontWeight: 600 }}>{data.label}</span>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: statusColor,
          }}
          title={data.status ?? 'unknown'}
        />
      </div>
      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>
        {data.type}
        {data.port ? ` · :${data.port}` : ''}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: palette.color }} />
    </div>
  )
}
