{{#IF_POSTGRES}}
package com.blissful.controller

import com.fasterxml.jackson.databind.ObjectMapper
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.math.BigDecimal
import java.time.Instant
{{#IF_REDIS}}
import com.blissful.service.ProductService
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
import com.blissful.entity.Product
import com.blissful.repository.ProductRepository
import java.util.Optional
{{/IF_NO_REDIS}}

@WebMvcTest(ProductController::class)
class ProductControllerTest {

    @TestConfiguration
    class TestConfig {
{{#IF_REDIS}}
        @Bean fun productService(): ProductService = mockk(relaxed = true)
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
        @Bean fun productRepository(): ProductRepository = mockk(relaxed = true)
{{/IF_NO_REDIS}}
    }

    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var objectMapper: ObjectMapper
{{#IF_REDIS}}
    @Autowired private lateinit var productService: ProductService
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
    @Autowired private lateinit var productRepository: ProductRepository
{{/IF_NO_REDIS}}

    private fun makeProduct(id: Long = 1L, name: String = "Widget", category: String = "Electronics",
                            price: BigDecimal = BigDecimal("29.99"), inStock: Boolean = true) =
        com.blissful.entity.Product(id = id, name = name, category = category, price = price,
            inStock = inStock, createdAt = Instant.parse("2024-01-15T10:00:00Z"))

    @Test
    fun `GET products returns list`() {
        val product = makeProduct()
{{#IF_REDIS}}
        every { productService.findAll() } returns listOf(product)
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
        every { productRepository.findAll() } returns listOf(product)
{{/IF_NO_REDIS}}

        mockMvc.perform(get("/products"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.products[0].name").value("Widget"))
            .andExpect(jsonPath("$.products[0].category").value("Electronics"))
            .andExpect(jsonPath("$.total").value(1))
    }

    @Test
    fun `GET products filters by category`() {
        val product = makeProduct(category = "Furniture")
{{#IF_REDIS}}
        every { productService.findByCategory("Furniture") } returns listOf(product)
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
        every { productRepository.findByCategory("Furniture") } returns listOf(product)
{{/IF_NO_REDIS}}

        mockMvc.perform(get("/products?category=Furniture"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.products[0].category").value("Furniture"))
    }

    @Test
    fun `GET products filters by inStock`() {
        val product = makeProduct(inStock = true)
{{#IF_REDIS}}
        every { productService.findByInStock(true) } returns listOf(product)
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
        every { productRepository.findByInStock(true) } returns listOf(product)
{{/IF_NO_REDIS}}

        mockMvc.perform(get("/products?inStock=true"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.products[0].inStock").value(true))
    }

    @Test
    fun `GET product by id returns product`() {
        val product = makeProduct(id = 42L)
{{#IF_REDIS}}
        every { productService.findById(42L) } returns product
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
        every { productRepository.findById(42L) } returns Optional.of(product)
{{/IF_NO_REDIS}}

        mockMvc.perform(get("/products/42"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.id").value(42))
            .andExpect(jsonPath("$.name").value("Widget"))
    }

    @Test
    fun `GET product by id returns 404 when not found`() {
{{#IF_REDIS}}
        every { productService.findById(99L) } returns null
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
        every { productRepository.findById(99L) } returns Optional.empty()
{{/IF_NO_REDIS}}

        mockMvc.perform(get("/products/99"))
            .andExpect(status().isNotFound)
    }

{{#IF_REDIS}}
    @Test
    fun `POST products creates and returns 201`() {
        val created = makeProduct(id = 5L, name = "New Item")
        every { productService.create("New Item", "Electronics", BigDecimal("49.99"), true) } returns created

        val body = """{"name":"New Item","category":"Electronics","price":49.99,"inStock":true}"""

        mockMvc.perform(
            post("/products")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
        )
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.id").value(5))
            .andExpect(jsonPath("$.name").value("New Item"))

        verify { productService.create("New Item", "Electronics", BigDecimal("49.99"), true) }
    }
{{/IF_REDIS}}
}
{{/IF_POSTGRES}}
