package com.blissful.websocket

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.KotlinModule
import com.fasterxml.jackson.module.kotlin.readValue
import org.slf4j.LoggerFactory
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.TextWebSocketHandler
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
{{#IF_POSTGRES}}
import com.blissful.service.ChatMessageService
{{/IF_POSTGRES}}

data class WebSocketEvent(
    val type: String,
    val payload: Any?,
    val timestamp: Long = System.currentTimeMillis()
)

private data class ClientMessage(val type: String, val payload: Map<String, Any?> = emptyMap())

private data class PersistedMessage(
    val from: String,
    val sessionId: String,
    val text: String,
    val timestamp: Long,
)

class EventWebSocketHandler(
{{#IF_POSTGRES}}
    private val chatMessageService: ChatMessageService? = null
{{/IF_POSTGRES}}
{{#IF_NO_POSTGRES}}
    // no-arg constructor when Postgres is not enabled
{{/IF_NO_POSTGRES}}
) : TextWebSocketHandler() {

    private val logger = LoggerFactory.getLogger(javaClass)

    private val sessions = ConcurrentHashMap<String, WebSocketSession>()
    private val names = ConcurrentHashMap<String, String>()

    // Rolling in-memory history — last 50 chat messages
    private val history = CopyOnWriteArrayList<PersistedMessage>()
    private val maxHistory = 50

    private val objectMapper = ObjectMapper().registerModule(KotlinModule.Builder().build())

    override fun afterConnectionEstablished(session: WebSocketSession) {
        val cookieName = session.handshakeHeaders["Cookie"]
            ?.split(";")
            ?.map { it.trim() }
            ?.firstOrNull { it.startsWith("chat_name=") }
            ?.removePrefix("chat_name=")
            ?.trim()
            ?.take(20)
            ?.ifBlank { null }
        val name = cookieName ?: "User-${session.id.take(4)}"
        sessions[session.id] = session
        names[session.id] = name
        logger.info("WebSocket connected: {} ({}), total: {}", name, session.id, sessions.size)

        // Tell the joining client their name, session id, and current user count
        send(session, WebSocketEvent(
            type = "connected",
            payload = mapOf("sessionId" to session.id, "name" to name, "count" to sessions.size)
        ))

        // Replay recent history to the joining client
        if (history.isNotEmpty()) {
            send(session, WebSocketEvent(
                type = "history",
                payload = mapOf("messages" to history.toList())
            ))
        }

        // Notify everyone else
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
                "chat" -> {
                    val text = incoming.payload["text"] as? String ?: return
                    logger.debug("Chat from {}: {}", senderName, text)

                    val ts = System.currentTimeMillis()

                    // Persist to in-memory history
                    history.add(PersistedMessage(from = senderName, sessionId = session.id, text = text, timestamp = ts))
                    if (history.size > maxHistory) history.removeAt(0)

                    // Persist to DB if available
{{#IF_POSTGRES}}
                    try { chatMessageService?.save(session.id, senderName, text) } catch (e: Exception) {
                        logger.warn("Failed to persist chat message: {}", e.message)
                    }
{{/IF_POSTGRES}}

                    broadcast(WebSocketEvent(
                        type = "chat",
                        payload = mapOf("from" to senderName, "sessionId" to session.id, "text" to text),
                        timestamp = ts,
                    ))
                }

                "set-name" -> {
                    val newName = (incoming.payload["name"] as? String)
                        ?.trim()
                        ?.take(20)
                        ?.ifBlank { null }
                        ?: return

                    val oldName = names[session.id] ?: senderName
                    names[session.id] = newName
                    logger.info("Rename: {} -> {}", oldName, newName)

                    send(session, WebSocketEvent(
                        type = "name-changed",
                        payload = mapOf("name" to newName)
                    ))

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
