{{#IF_POSTGRES}}
{{#IF_REDIS}}
package com.blissful.service

import com.blissful.entity.Product
import com.blissful.repository.ProductRepository
import org.slf4j.LoggerFactory
import org.springframework.cache.annotation.CacheEvict
import org.springframework.cache.annotation.Cacheable
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal

@Service
@Transactional(readOnly = true)
class ProductService(private val productRepository: ProductRepository) {

    private val logger = LoggerFactory.getLogger(javaClass)

    @Cacheable("products")
    fun findAll(): List<Product> {
        logger.debug("Cache miss — loading all products from DB")
        return productRepository.findAll()
    }

    @Cacheable("products", key = "#category")
    fun findByCategory(category: String): List<Product> {
        logger.debug("Cache miss — loading products by category={}", category)
        return productRepository.findByCategory(category)
    }

    @Cacheable("products", key = "'inStock-' + #inStock")
    fun findByInStock(inStock: Boolean): List<Product> {
        logger.debug("Cache miss — loading products inStock={}", inStock)
        return productRepository.findByInStock(inStock)
    }

    @Cacheable("product", key = "#id")
    fun findById(id: Long): Product? {
        logger.debug("Cache miss — loading product id={}", id)
        return productRepository.findById(id).orElse(null)
    }

    @Transactional
    @CacheEvict(cacheNames = ["products", "product"], allEntries = true)
    fun create(name: String, category: String, price: BigDecimal, inStock: Boolean): Product {
        logger.info("Creating product name={}, category={}", name, category)
        return productRepository.save(
            Product(name = name, category = category, price = price, inStock = inStock)
        )
    }
}
{{/IF_REDIS}}
{{/IF_POSTGRES}}
