{{#IF_LOCALSTACK}}
package com.blissful.config

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.dynamodb.DynamoDbClient
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.S3Configuration
import software.amazon.awssdk.services.s3.presigner.S3Presigner
import software.amazon.awssdk.services.sqs.SqsClient
import java.net.URI

@Configuration
class AwsConfig(
    @Value("\${aws.endpoint-url}") private val endpointUrl: String,
    @Value("\${aws.public-endpoint-url:\${aws.endpoint-url}}") private val publicEndpointUrl: String,
    @Value("\${aws.region}") private val region: String,
    @Value("\${aws.access-key}") private val accessKey: String,
    @Value("\${aws.secret-key}") private val secretKey: String,
) {
    private val credentials = StaticCredentialsProvider.create(
        AwsBasicCredentials.create(accessKey, secretKey)
    )
    private val endpoint = URI.create(endpointUrl)
    private val publicEndpoint = URI.create(publicEndpointUrl)
    private val awsRegion = Region.of(region)

    @Bean
    fun s3Client(): S3Client = S3Client.builder()
        .endpointOverride(endpoint)
        .region(awsRegion)
        .credentialsProvider(credentials)
        .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
        .build()

    @Bean
    fun sqsClient(): SqsClient = SqsClient.builder()
        .endpointOverride(endpoint)
        .region(awsRegion)
        .credentialsProvider(credentials)
        .build()

    @Bean
    fun dynamoDbClient(): DynamoDbClient = DynamoDbClient.builder()
        .endpointOverride(endpoint)
        .region(awsRegion)
        .credentialsProvider(credentials)
        .build()

    @Bean
    fun s3Presigner(): S3Presigner = S3Presigner.builder()
        .endpointOverride(publicEndpoint)
        .region(awsRegion)
        .credentialsProvider(credentials)
        .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
        .build()
}
{{/IF_LOCALSTACK}}
