import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    id("org.springframework.boot") version "3.4.1"
    id("io.spring.dependency-management") version "1.1.7"
    kotlin("jvm") version "2.1.0"
    kotlin("plugin.spring") version "2.1.0"
{{#IF_POSTGRES}}
    kotlin("plugin.jpa") version "2.1.0"
{{/IF_POSTGRES}}
}

group = "com.blissful"
version = "0.0.1-SNAPSHOT"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

repositories {
    mavenCentral()
}

dependencies {
    // Spring Boot
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-websocket")

    // Metrics (Prometheus)
    implementation("io.micrometer:micrometer-registry-prometheus")
{{#IF_POSTGRES}}
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
    runtimeOnly("org.postgresql:postgresql")
{{/IF_POSTGRES}}
{{#IF_REDIS}}
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
{{/IF_REDIS}}
{{#IF_KEYCLOAK}}
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
{{/IF_KEYCLOAK}}

    // Kotlin
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")
    implementation("org.jetbrains.kotlin:kotlin-reflect")

    // Kafka
    implementation("org.springframework.kafka:spring-kafka")

    // Logging
    implementation("net.logstash.logback:logstash-logback-encoder:7.4")

    // Development
    developmentOnly("org.springframework.boot:spring-boot-devtools")

    // Testing
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.kafka:spring-kafka-test")
    testImplementation("io.mockk:mockk:1.13.9")
{{#IF_POSTGRES}}
    testImplementation("com.h2database:h2")
{{/IF_POSTGRES}}
}

tasks.withType<KotlinCompile> {
    compilerOptions {
        freeCompilerArgs.add("-Xjsr305=strict")
    }
}

tasks.withType<Test> {
    useJUnitPlatform()
}
