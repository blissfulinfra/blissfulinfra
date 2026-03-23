package com.blissful.config

import com.blissful.websocket.EventWebSocketHandler
{{#IF_POSTGRES}}
import com.blissful.service.ChatMessageService
{{/IF_POSTGRES}}
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.socket.config.annotation.EnableWebSocket
import org.springframework.web.socket.config.annotation.WebSocketConfigurer
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry

@Configuration
@EnableWebSocket
class WebSocketConfig(
{{#IF_POSTGRES}}
    private val chatMessageService: ChatMessageService
{{/IF_POSTGRES}}
) : WebSocketConfigurer {

    @Bean
    fun eventWebSocketHandler(): EventWebSocketHandler {
{{#IF_POSTGRES}}
        return EventWebSocketHandler(chatMessageService)
{{/IF_POSTGRES}}
{{#IF_NO_POSTGRES}}
        return EventWebSocketHandler()
{{/IF_NO_POSTGRES}}
    }

    override fun registerWebSocketHandlers(registry: WebSocketHandlerRegistry) {
        registry.addHandler(eventWebSocketHandler(), "/ws/events")
            .setAllowedOrigins("*")
    }
}
