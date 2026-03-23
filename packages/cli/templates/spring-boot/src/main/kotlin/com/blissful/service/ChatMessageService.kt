{{#IF_POSTGRES}}
package com.blissful.service

import com.blissful.entity.ChatMessage
import com.blissful.repository.ChatMessageRepository
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional(readOnly = true)
class ChatMessageService(private val repo: ChatMessageRepository) {

    fun findRecent(limit: Int = 50): List<ChatMessage> =
        repo.findAllByOrderByCreatedAtDesc(PageRequest.of(0, limit)).reversed()

    @Transactional
    fun save(sessionId: String, author: String, body: String): ChatMessage =
        repo.save(ChatMessage(sessionId = sessionId, author = author, body = body))
}
{{/IF_POSTGRES}}
