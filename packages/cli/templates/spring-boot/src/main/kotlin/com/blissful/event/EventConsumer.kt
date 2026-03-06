package com.blissful.event

import com.blissful.sse.SseController
import com.blissful.websocket.EventWebSocketHandler
import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.kafka.annotation.KafkaListener
import org.springframework.stereotype.Component

@Component
class EventConsumer(
    private val webSocketHandler: EventWebSocketHandler,
    private val sseController: SseController,
    private val objectMapper: ObjectMapper,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    @KafkaListener(topics = ["events"], groupId = "{{PROJECT_NAME}}-consumer")
    fun consume(message: String) {
        logger.info("Received event from Kafka: {}", message)

        // Forward to WebSocket clients (bidirectional)
        webSocketHandler.broadcast("kafka-event", message)

        // Forward to SSE clients (server→client only)
        try {
            val event = objectMapper.readValue(message, GreetingEvent::class.java)
            sseController.broadcast(event)
        } catch (e: Exception) {
            logger.debug("Could not deserialize as GreetingEvent for SSE broadcast: {}", e.message)
        }
    }
}
