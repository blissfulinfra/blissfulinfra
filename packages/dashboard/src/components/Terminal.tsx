import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X } from 'lucide-react'

interface Props {
  onClose: () => void
}

/**
 * In-dashboard terminal. xterm.js renders the PTY output streamed over a
 * WebSocket from the API server's terminal endpoint. Keystrokes (and a
 * `{type:'resize'}` control frame on resize) go back the other way.
 *
 * Scope: the PTY lives inside the dashboard container, so you can run any
 * `blissful-infra` command, drive `docker` against the host socket, and
 * read/edit anything under `~/.blissful-infra` (mounted at /blissful-home).
 * Your repo source code is NOT mounted — this is an operator console, not
 * an editor.
 */
export function Terminal({ onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      theme: {
        background: '#0b1020',
        foreground: '#e5e7eb',
        cursor: '#60a5fa',
        selectionBackground: '#374151',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    // ws:// for plain HTTP, wss:// if served over TLS. The dashboard
    // doesn't run with TLS today but this future-proofs it.
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${window.location.host}/api/v1/terminal`)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      // Push initial size so the shell wraps correctly from the first line.
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      term.focus()
    }
    ws.onmessage = ev => {
      const data = typeof ev.data === 'string'
        ? ev.data
        : new TextDecoder().decode(new Uint8Array(ev.data as ArrayBuffer))
      term.write(data)
    }
    ws.onerror = () => {
      term.write('\r\n\x1b[31m[connection error — is the dashboard running?]\x1b[0m\r\n')
    }
    ws.onclose = () => {
      term.write('\r\n\x1b[33m[session ended]\x1b[0m\r\n')
    }

    const onData = term.onData(input => {
      if (ws.readyState === WebSocket.OPEN) ws.send(input)
    })

    const onResize = () => {
      fit.fit()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      onData.dispose()
      try { ws.close() } catch { /* ignore */ }
      term.dispose()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-100">Terminal</span>
          <span className="text-xs text-gray-500">inside blissful-dashboard · /blissful-home</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded"
          title="Close (the PTY exits)"
          aria-label="Close terminal"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 p-2" style={{ background: '#0b1020' }} />
    </div>
  )
}
