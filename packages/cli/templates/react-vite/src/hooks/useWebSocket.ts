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
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = url.startsWith('/') ? `${protocol}//${window.location.host}${url}` : url

    try {
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        setConnected(true)
        reconnectAttemptsRef.current = 0
        onOpenRef.current?.()
      }

      ws.onclose = () => {
        setConnected(false)
        onCloseRef.current?.()

        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
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
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    reconnectAttemptsRef.current = maxReconnectAttempts
    wsRef.current?.close()
  }, [maxReconnectAttempts])

  const send = useCallback((data: string | object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === 'string' ? data : JSON.stringify(data))
    }
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  useEffect(() => {
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
