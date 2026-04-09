{{#IF_LOCALSTACK}}
package com.blissful.service

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.services.dynamodb.DynamoDbClient
import software.amazon.awssdk.services.dynamodb.model.AttributeValue
import software.amazon.awssdk.services.dynamodb.model.GetItemRequest
import software.amazon.awssdk.services.dynamodb.model.PutItemRequest
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.core.sync.ResponseTransformer
import software.amazon.awssdk.services.s3.model.GetObjectRequest
import software.amazon.awssdk.services.s3.model.HeadObjectRequest
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request
import software.amazon.awssdk.services.s3.model.PutObjectRequest
import software.amazon.awssdk.services.s3.presigner.S3Presigner
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest
import software.amazon.awssdk.services.sqs.SqsClient
import software.amazon.awssdk.services.sqs.model.SendMessageRequest
import java.time.Duration

@Service
class StorageService(
    private val s3: S3Client,
    private val presigner: S3Presigner,
    private val sqs: SqsClient,
    private val dynamo: DynamoDbClient,
    @Value("\${aws.s3.bucket}") private val bucket: String,
    @Value("\${aws.sqs.queue-url}") private val queueUrl: String,
    @Value("\${aws.dynamodb.table}") private val table: String,
) {
    fun uploadFile(key: String, content: ByteArray, contentType: String): String {
        s3.putObject(
            PutObjectRequest.builder().bucket(bucket).key(key).contentType(contentType).build(),
            RequestBody.fromBytes(content),
        )
        return "s3://$bucket/$key"
    }

    data class FileContent(val bytes: ByteArray, val contentType: String, val key: String)

    fun getFileContent(key: String): FileContent {
        val head = s3.headObject(HeadObjectRequest.builder().bucket(bucket).key(key).build())
        val contentType = head.contentType() ?: "application/octet-stream"
        val bytes = s3.getObject(
            GetObjectRequest.builder().bucket(bucket).key(key).build(),
            ResponseTransformer.toBytes(),
        ).asByteArray()
        return FileContent(bytes, contentType, key)
    }

    fun getPresignedUrl(key: String, expiresIn: Duration = Duration.ofMinutes(15)): String {
        val presignRequest = GetObjectPresignRequest.builder()
            .signatureDuration(expiresIn)
            .getObjectRequest(GetObjectRequest.builder().bucket(bucket).key(key).build())
            .build()
        return presigner.presignGetObject(presignRequest).url().toString()
    }

    fun listFiles(): List<String> =
        s3.listObjectsV2(ListObjectsV2Request.builder().bucket(bucket).build())
            .contents()
            .map { it.key() }

    fun publishEvent(message: String): String =
        sqs.sendMessage(
            SendMessageRequest.builder().queueUrl(queueUrl).messageBody(message).build()
        ).messageId()

    fun putItem(id: String, data: Map<String, String>): String {
        val item = data.mapValues { AttributeValue.builder().s(it.value).build() }.toMutableMap()
        item["pk"] = AttributeValue.builder().s("ITEM#$id").build()
        item["sk"] = AttributeValue.builder().s("v0").build()
        dynamo.putItem(PutItemRequest.builder().tableName(table).item(item).build())
        return id
    }

    fun getItem(id: String): Map<String, String>? {
        val result = dynamo.getItem(
            GetItemRequest.builder()
                .tableName(table)
                .key(
                    mapOf(
                        "pk" to AttributeValue.builder().s("ITEM#$id").build(),
                        "sk" to AttributeValue.builder().s("v0").build(),
                    )
                )
                .build()
        )
        return if (result.hasItem()) result.item().mapValues { it.value.s() } else null
    }
}
{{/IF_LOCALSTACK}}
