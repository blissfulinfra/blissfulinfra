{{#IF_POSTGRES}}
package com.blissful.controller

import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException
import java.math.BigDecimal
{{#IF_REDIS}}
import com.blissful.service.ProductService
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
import com.blissful.repository.ProductRepository
{{/IF_NO_REDIS}}

data class ProductDto(
    val id: Long,
    val name: String,
    val category: String,
    val price: BigDecimal,
    val inStock: Boolean,
    val createdAt: String
)

data class ProductsResponse(
    val products: List<ProductDto>,
    val total: Long
)

data class CreateProductRequest(
    val name: String,
    val category: String,
    val price: BigDecimal,
    val inStock: Boolean = true
)

@RestController
@RequestMapping("/products")
class ProductController(
{{#IF_REDIS}}
    private val productService: ProductService
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
    private val productRepository: ProductRepository
{{/IF_NO_REDIS}}
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    @GetMapping
    fun list(
        @RequestParam(required = false) category: String?,
        @RequestParam(required = false) inStock: Boolean?
    ): ProductsResponse {
        logger.info("Fetching products, category={}, inStock={}", category, inStock)

        val products = when {
{{#IF_REDIS}}
            category != null -> productService.findByCategory(category)
            inStock != null  -> productService.findByInStock(inStock)
            else             -> productService.findAll()
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
            category != null -> productRepository.findByCategory(category)
            inStock != null  -> productRepository.findByInStock(inStock)
            else             -> productRepository.findAll()
{{/IF_NO_REDIS}}
        }

        return ProductsResponse(
            products = products.map { p ->
                ProductDto(
                    id        = p.id!!,
                    name      = p.name,
                    category  = p.category,
                    price     = p.price,
                    inStock   = p.inStock,
                    createdAt = p.createdAt.toString()
                )
            },
            total = products.size.toLong()
        )
    }

    @GetMapping("/{id}")
    fun get(@PathVariable id: Long): ProductDto {
        logger.info("Fetching product id={}", id)
{{#IF_REDIS}}
        val p = productService.findById(id)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Product $id not found")
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
        val p = productRepository.findById(id)
            .orElseThrow { ResponseStatusException(HttpStatus.NOT_FOUND, "Product $id not found") }
{{/IF_NO_REDIS}}
        return ProductDto(
            id        = p.id!!,
            name      = p.name,
            category  = p.category,
            price     = p.price,
            inStock   = p.inStock,
            createdAt = p.createdAt.toString()
        )
    }

{{#IF_REDIS}}
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@RequestBody req: CreateProductRequest): ProductDto {
        logger.info("Creating product name={}, category={}", req.name, req.category)
        val p = productService.create(req.name, req.category, req.price, req.inStock)
        return ProductDto(
            id        = p.id!!,
            name      = p.name,
            category  = p.category,
            price     = p.price,
            inStock   = p.inStock,
            createdAt = p.createdAt.toString()
        )
    }
{{/IF_REDIS}}
}
{{/IF_POSTGRES}}
