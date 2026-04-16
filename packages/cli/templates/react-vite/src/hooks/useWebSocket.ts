import { useEffect, useState, useRef, useCallback } from 'react'

interface UseWebSocketOptions {
  onMessage?: (data: string) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: Event) => void
  reconnectInterval?: number
  maxReconnectAttempts?: number
}

export function useWebSocket(url: string, options: UseWebSocketOptions = {}) {
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const destroyedRef = useRef(false)

  // Store callbacks in refs so they never invalidate `connect`
  const onMessageRef = useRef(options.onMessage)
  const onOpenRef = useRef(options.onOpen)
  const onCloseRef = useRef(options.onClose)
  const onErrorRef = useRef(options.onError)
  useEffect(() => { onMessageRef.current = options.onMessage }, [options.onMessage])
  useEffect(() => { onOpenRef.current = options.onOpen }, [options.onOpen])
  useEffect(() => { onCloseRef.current = options.onClose }, [options.onClose])
  useEffect(() => { onErrorRef.current = options.onError }, [options.onError])

  const reconnectInterval = options.reconnectInterval ?? 3000
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 5

  const connect = useCallback(() => {
    if (destroyedRef.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = url.startsWith('/') ? `${protocol}//${window.location.host}${url}` : url

    try {
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        if (destroyedRef.current) { ws.close(); return }
        setConnected(true)
        reconnectAttemptsRef.current = 0
        onOpenRef.current?.()
      }

      ws.onclose = () => {
        setConnected(false)
        onCloseRef.current?.()

        if (!destroyedRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++
          reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval)
        }
      }

      ws.onerror = (error) => {
        onErrorRef.current?.(error)
      }

      ws.onmessage = (event) => {
        const data = event.data
        setMessages((prev) => [...prev, data])
        onMessageRef.current?.(data)
      }

      wsRef.current = ws
    } catch {
      // WebSocket connection failed
    }
  }, [url, reconnectInterval, maxReconnectAttempts])

  const disconnect = useCallback(() => {
    destroyedRef.current = true
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    const ws = wsRef.current
    wsRef.current = null
    if (!ws) return
    if (ws.readyState === WebSocket.CONNECTING) {
      // Can't close a CONNECTING socket — null the handlers so it opens
      // silently and closes without triggering reconnect or state updates.
      ws.onopen = () => ws.close()
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null
    } else if (ws.readyState === WebSocket.OPEN) {
      ws.close()
    }
  }, [])

  const send = useCallback((data: string | object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === 'string' ? data : JSON.stringify(data))
    }
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  useEffect(() => {
    destroyedRef.current = false
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    connected,
    messages,
    send,
    clearMessages,
    reconnect: connect,
    disconnect,
  }
}
