{{#IF_POSTGRES}}
package com.blissful.repository

import com.blissful.entity.ChatMessage
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository

@Repository
interface ChatMessageRepository : JpaRepository<ChatMessage, Long> {
    fun findAllByOrderByCreatedAtDesc(pageable: Pageable): List<ChatMessage>
}
{{/IF_POSTGRES}}
