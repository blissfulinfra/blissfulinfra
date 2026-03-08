package com.blissful.sse

import com.blissful.event.DomainEvent
import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Server-Sent Events endpoint — unidirectional server→client streaming.
 *
 * Use SSE when:
 *   - You only need server→client push (e.g. live feed, notifications, build logs)
 *   - Clients are browsers that can use the native EventSource API
 *   - You want automatic reconnection for free (browsers retry on disconnect)
 *
 * Use WebSocket (/ws/events) when you also need client→server messaging.
 *
 * curl http://localhost:8080/events/stream
 * JS:  const es = new EventSource('/api/events/stream')  // Vite proxy strips /api
 *      es.addEventListener('greeting.created', e => console.log(JSON.parse(e.data)))
 */
@RestController
@RequestMapping("/events")
class SseController(private val objectMapper: ObjectMapper) {

    private val logger = LoggerFactory.getLogger(javaClass)
    private val emitters = CopyOnWriteArrayList<SseEmitter>()

    /** Open a new SSE stream. The connection stays alive until the client disconnects. */
    @GetMapping("/stream", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun stream(): SseEmitter {
        // timeout = 0 means no server-side timeout; adjust (e.g. 30_000L) for load-balanced envs
        val emitter = SseEmitter(0L)

        emitters.add(emitter)
        logger.info("SSE client connected, total: {}", emitters.size)

        emitter.onCompletion {
            emitters.remove(emitter)
            logger.info("SSE client disconnected, total: {}", emitters.size)
        }
        emitter.onTimeout {
            emitters.remove(emitter)
            emitter.complete()
        }
        emitter.onError { _ ->
            emitters.remove(emitter)
        }

        // Send an initial "connected" comment so the client knows the stream is live
        emitter.send(
            SseEmitter.event()
                .comment("connected")
                .build()
        )

        return emitter
    }

    /**
     * Push a domain event to all connected SSE clients.
     * Called by [com.blissful.event.EventConsumer] after consuming from Kafka.
     *
     * Each SSE frame:
     *   event: greeting.created
     *   data: {"eventId":"…","name":"Alice","occurredAt":"…"}
     */
    fun broadcast(event: DomainEvent) {
        if (emitters.isEmpty()) return

        val data = objectMapper.writeValueAsString(event)
        val sseEvent = SseEmitter.event()
            .id(event.eventId)
            .name(event.eventType)   // becomes the JS EventSource event name
            .data(data)
            .build()

        val dead = mutableListOf<SseEmitter>()
        emitters.forEach { emitter ->
            try {
                emitter.send(sseEvent)
            } catch (e: Exception) {
                logger.warn("SSE send failed, removing emitter: {}", e.message)
                dead.add(emitter)
            }
        }
        emitters.removeAll(dead)
    }
}
