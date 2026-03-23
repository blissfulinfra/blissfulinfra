package com.blissful.controller

import com.blissful.event.EventPublisher
import com.blissful.event.GreetingEvent
import com.blissful.websocket.EventWebSocketHandler
{{#IF_POSTGRES}}
import com.blissful.service.GreetingService
import com.blissful.service.ChatMessageService
{{/IF_POSTGRES}}
import org.slf4j.LoggerFactory
import org.springframework.web.bind.annotation.*
import java.util.UUID

{{#IF_POSTGRES}}
data class HelloResponse(
    val message: String,
    val savedId: Long? = null,
    val totalGreetings: Long? = null
)
{{/IF_POSTGRES}}
{{#IF_NO_POSTGRES}}
data class HelloResponse(
    val message: String
)
{{/IF_NO_POSTGRES}}

data class EchoRequest(val data: Any?)
data class EchoResponse(val echo: Any?)

{{#IF_POSTGRES}}
data class GreetingHistoryResponse(val greetings: List<GreetingDto>)

data class GreetingDto(
    val id: Long,
    val name: String,
    val message: String,
    val createdAt: String
)

data class ChatMessageDto(
    val id: Long,
    val sessionId: String,
    val author: String,
    val body: String,
    val createdAt: String
)

data class ChatHistoryResponse(val messages: List<ChatMessageDto>, val total: Int)
{{/IF_POSTGRES}}

@RestController
class HelloController(
    private val eventPublisher: EventPublisher,
    private val webSocketHandler: EventWebSocketHandler,
{{#IF_POSTGRES}}
    private val greetingService: GreetingService,
    private val chatMessageService: ChatMessageService
{{/IF_POSTGRES}}
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    @GetMapping("/hello")
    fun hello(): HelloResponse {
        logger.info("Received hello request")
        eventPublisher.publish(GreetingEvent(eventId = UUID.randomUUID().toString(), name = "World"))
        webSocketHandler.broadcast("greeting", mapOf("name" to "World", "message" to "Hello, World!"))
{{#IF_POSTGRES}}
        val saved = greetingService.save("World", "Hello, World!")
        return HelloResponse(message = "Hello, World!", savedId = saved.id, totalGreetings = greetingService.count())
{{/IF_POSTGRES}}
{{#IF_NO_POSTGRES}}
        return HelloResponse(message = "Hello, World!")
{{/IF_NO_POSTGRES}}
    }

    @GetMapping("/hello/{name}")
    fun helloName(@PathVariable name: String): HelloResponse {
        logger.info("Received hello request for name: {}", name)
        eventPublisher.publish(GreetingEvent(eventId = UUID.randomUUID().toString(), name = name))
        webSocketHandler.broadcast("greeting", mapOf("name" to name, "message" to "Hello, $name!"))
{{#IF_POSTGRES}}
        val saved = greetingService.save(name, "Hello, $name!")
        return HelloResponse(message = "Hello, $name!", savedId = saved.id, totalGreetings = greetingService.count())
{{/IF_POSTGRES}}
{{#IF_NO_POSTGRES}}
        return HelloResponse(message = "Hello, $name!")
{{/IF_NO_POSTGRES}}
    }

    @PostMapping("/echo")
    fun echo(@RequestBody request: EchoRequest): EchoResponse {
        logger.info("Received echo request")
        return EchoResponse(echo = request.data)
    }

{{#IF_POSTGRES}}
    @GetMapping("/greetings")
    fun getGreetings(): GreetingHistoryResponse {
        logger.info("Fetching recent greetings")
        return GreetingHistoryResponse(greetings = greetingService.findRecent().map { it.toDto() })
    }

    @GetMapping("/greetings/{name}")
    fun getGreetingsByName(@PathVariable name: String): GreetingHistoryResponse {
        logger.info("Fetching greetings for name: {}", name)
        return GreetingHistoryResponse(greetings = greetingService.findByName(name).map { it.toDto() })
    }

    @GetMapping("/messages")
    fun getMessages(@RequestParam(defaultValue = "50") limit: Int): ChatHistoryResponse {
        val messages = chatMessageService.findRecent(limit.coerceIn(1, 200))
        return ChatHistoryResponse(
            messages = messages.map {
                ChatMessageDto(
                    id = it.id!!,
                    sessionId = it.sessionId,
                    author = it.author,
                    body = it.body,
                    createdAt = it.createdAt.toString()
                )
            },
            total = messages.size
        )
    }

    private fun com.blissful.entity.Greeting.toDto() = GreetingDto(
        id = id!!,
        name = name,
        message = message,
        createdAt = createdAt.toString()
    )
{{/IF_POSTGRES}}
}
