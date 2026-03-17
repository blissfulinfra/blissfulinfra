{{#IF_POSTGRES}}
package com.blissful.service

import com.blissful.entity.Greeting
import com.blissful.repository.GreetingRepository
import org.slf4j.LoggerFactory
{{#IF_REDIS}}
import org.springframework.cache.annotation.CacheEvict
import org.springframework.cache.annotation.Cacheable
{{/IF_REDIS}}
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional(readOnly = true)
class GreetingService(private val greetingRepository: GreetingRepository) {

    private val logger = LoggerFactory.getLogger(javaClass)

{{#IF_REDIS}}
    @Cacheable("greetings")
{{/IF_REDIS}}
    fun findRecent(): List<Greeting> {
        logger.debug("Loading recent greetings from DB")
        return greetingRepository.findTop10ByOrderByCreatedAtDesc()
    }

{{#IF_REDIS}}
    @Cacheable("greetings", key = "#name")
{{/IF_REDIS}}
    fun findByName(name: String): List<Greeting> {
        logger.debug("Loading greetings for name={}", name)
        return greetingRepository.findByNameIgnoreCase(name)
    }

    @Transactional
{{#IF_REDIS}}
    @CacheEvict(value = ["greetings"], allEntries = true)
{{/IF_REDIS}}
    fun save(name: String, message: String): Greeting {
        logger.info("Saving greeting for name={}", name)
        return greetingRepository.save(Greeting(name = name, message = message))
    }

    fun count(): Long = greetingRepository.count()
}
{{/IF_POSTGRES}}
