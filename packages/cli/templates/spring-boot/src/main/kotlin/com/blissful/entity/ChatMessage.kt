{{#IF_POSTGRES}}
package com.blissful.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "chat_messages")
data class ChatMessage(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long? = null,

    @Column(name = "session_id", nullable = false)
    val sessionId: String,

    @Column(nullable = false, length = 50)
    val author: String,

    @Column(nullable = false, columnDefinition = "TEXT")
    val body: String,

    @Column(name = "created_at", nullable = false)
    val createdAt: Instant = Instant.now()
)
{{/IF_POSTGRES}}
