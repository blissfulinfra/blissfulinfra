{{#IF_LOCALSTACK}}
package com.blissful.controller

import com.blissful.service.StorageService
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import java.time.Duration
import java.util.UUID

@RestController
@RequestMapping("/api/storage")
class StorageController(private val storageService: StorageService) {

    /** Get a presigned PUT URL for direct browser-to-S3 upload. Returns { uploadUrl, key }. */
    @PostMapping("/files/presign")
    fun presignUpload(
        @RequestParam filename: String,
        @RequestParam(defaultValue = "application/octet-stream") contentType: String,
        @RequestParam(defaultValue = "15") ttlMinutes: Long,
    ): ResponseEntity<Map<String, String>> {
        val result = storageService.getPresignedPutUrl(filename, contentType, java.time.Duration.ofMinutes(ttlMinutes))
        return ResponseEntity.ok(mapOf("uploadUrl" to result.uploadUrl, "key" to result.key))
    }

    /** Upload a file to S3 (LocalStack). Returns the S3 URI and the object key. */
    @PostMapping("/files")
    fun uploadFile(@RequestParam file: MultipartFile): ResponseEntity<Map<String, String>> {
        val key = "${UUID.randomUUID()}-${file.originalFilename}"
        val uri = storageService.uploadFile(key, file.bytes, file.contentType ?: "application/octet-stream")
        return ResponseEntity.ok(mapOf("key" to key, "uri" to uri))
    }

    /** List all object keys in the project S3 bucket. */
    @GetMapping("/files")
    fun listFiles(): ResponseEntity<List<String>> =
        ResponseEntity.ok(storageService.listFiles())

    /**
     * Stream a file from S3 back to the browser with its original Content-Type so the browser
     * renders it inline (images, PDFs, text) rather than downloading it. This avoids any CORS
     * issues with hitting LocalStack directly.
     */
    @GetMapping("/files/{key}/content")
    fun getFileContent(@PathVariable key: String): ResponseEntity<ByteArray> {
        val file = storageService.getFileContent(key)
        val headers = HttpHeaders().apply {
            contentType = MediaType.parseMediaType(file.contentType)
            set(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"${file.key.substringAfterLast('/')}\"")
        }
        return ResponseEntity.ok().headers(headers).body(file.bytes)
    }

    /**
     * Generate a presigned GET URL for a file. The URL is valid for [ttlMinutes] minutes
     * (default 15) and can be shared with clients to download directly from S3/LocalStack
     * without proxying through this service.
     */
    @GetMapping("/files/{key}/url")
    fun getPresignedUrl(
        @PathVariable key: String,
        @RequestParam(defaultValue = "15") ttlMinutes: Long,
    ): ResponseEntity<Map<String, String>> {
        val url = storageService.getPresignedUrl(key, Duration.ofMinutes(ttlMinutes))
        return ResponseEntity.ok(mapOf("url" to url, "expiresInMinutes" to ttlMinutes.toString()))
    }

    /** Publish a message to the project SQS queue. */
    @PostMapping("/events")
    fun publishEvent(@RequestBody body: Map<String, String>): ResponseEntity<Map<String, String>> {
        val messageId = storageService.publishEvent(body["message"] ?: "")
        return ResponseEntity.ok(mapOf("messageId" to messageId))
    }

    /** Write an item to DynamoDB. Body keys become string attributes (pk/sk are reserved). */
    @PutMapping("/items/{id}")
    fun putItem(
        @PathVariable id: String,
        @RequestBody data: Map<String, String>,
    ): ResponseEntity<Map<String, String>> {
        storageService.putItem(id, data)
        return ResponseEntity.ok(mapOf("id" to id))
    }

    /** Fetch an item from DynamoDB by id. */
    @GetMapping("/items/{id}")
    fun getItem(@PathVariable id: String): ResponseEntity<Any> {
        val item = storageService.getItem(id) ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(item)
    }
}
{{/IF_LOCALSTACK}}
