package com.blissful.websocket

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import org.slf4j.LoggerFactory
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.TextWebSocketHandler
import java.util.concurrent.ConcurrentHashMap

data class WebSocketEvent(
    val type: String,
    val payload: Any?,
    val timestamp: Long = System.currentTimeMillis()
)

// Incoming message shape sent by clients
private data class ClientMessage(val type: String, val payload: Map<String, Any?> = emptyMap())

class EventWebSocketHandler : TextWebSocketHandler() {

    private val logger = LoggerFactory.getLogger(javaClass)

    // sessionId → WebSocketSession
    private val sessions = ConcurrentHashMap<String, WebSocketSession>()

    // sessionId → display name (e.g. "User-a1b2")
    private val names = ConcurrentHashMap<String, String>()

    private val objectMapper = ObjectMapper()

    override fun afterConnectionEstablished(session: WebSocketSession) {
        val name = "User-${session.id.take(4)}"
        sessions[session.id] = session
        names[session.id] = name
        logger.info("WebSocket connected: {} ({}), total: {}", name, session.id, sessions.size)

        // Tell the joining client their assigned name and session id
        send(session, WebSocketEvent(
            type = "connected",
            payload = mapOf("sessionId" to session.id, "name" to name)
        ))

        // Notify everyone else that a user joined
        broadcast(WebSocketEvent(
            type = "user-joined",
            payload = mapOf("name" to name, "count" to sessions.size)
        ), exclude = session.id)
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        val name = names.remove(session.id) ?: "Unknown"
        sessions.remove(session.id)
        logger.info("WebSocket disconnected: {} ({}), total: {}", name, session.id, sessions.size)

        broadcast(WebSocketEvent(
            type = "user-left",
            payload = mapOf("name" to name, "count" to sessions.size)
        ))
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        val senderName = names[session.id] ?: "Unknown"

        try {
            val incoming = objectMapper.readValue<ClientMessage>(message.payload)

            when (incoming.type) {
                // Client sends: { type: "chat", payload: { text: "hello" } }
                "chat" -> {
                    val text = incoming.payload["text"] as? String ?: return
                    logger.debug("Chat from {}: {}", senderName, text)

                    broadcast(WebSocketEvent(
                        type = "chat",
                        payload = mapOf(
                            "from" to senderName,
                            "sessionId" to session.id,
                            "text" to text,
                        )
                    ))
                }

                // Client sends: { type: "set-name", payload: { name: "Alice" } }
                "set-name" -> {
                    val newName = (incoming.payload["name"] as? String)
                        ?.trim()
                        ?.take(20)
                        ?.ifBlank { null }
                        ?: return

                    val oldName = names[session.id] ?: senderName
                    names[session.id] = newName
                    logger.info("Rename: {} → {}", oldName, newName)

                    // Confirm to the renaming client
                    send(session, WebSocketEvent(
                        type = "name-changed",
                        payload = mapOf("name" to newName)
                    ))

                    // Notify everyone
                    broadcast(WebSocketEvent(
                        type = "user-renamed",
                        payload = mapOf("oldName" to oldName, "newName" to newName)
                    ), exclude = session.id)
                }

                else -> logger.debug("Unknown message type '{}' from {}", incoming.type, senderName)
            }
        } catch (e: Exception) {
            logger.warn("Failed to parse message from {}: {}", senderName, e.message)
        }
    }

    override fun handleTransportError(session: WebSocketSession, exception: Throwable) {
        logger.error("WebSocket error for {}: {}", session.id, exception.message)
        sessions.remove(session.id)
        names.remove(session.id)
    }

    /** Broadcast an event to all connected sessions, optionally excluding one. */
    fun broadcast(event: WebSocketEvent, exclude: String? = null) {
        val message = TextMessage(objectMapper.writeValueAsString(event))
        sessions.forEach { (id, session) ->
            if (id == exclude) return@forEach
            try {
                if (session.isOpen) session.sendMessage(message)
            } catch (e: Exception) {
                logger.warn("Failed to send to {}: {}", id, e.message)
            }
        }
    }

    fun broadcast(type: String, payload: Any?) {
        broadcast(WebSocketEvent(type = type, payload = payload))
    }

    private fun send(session: WebSocketSession, event: WebSocketEvent) {
        try {
            session.sendMessage(TextMessage(objectMapper.writeValueAsString(event)))
        } catch (e: Exception) {
            logger.warn("Failed to send to {}: {}", session.id, e.message)
        }
    }
}
