package com.blissful.simulation

import io.gatling.javaapi.core.*
import io.gatling.javaapi.core.CoreDsl.*
import io.gatling.javaapi.http.*
import io.gatling.javaapi.http.HttpDsl.*
import java.time.Duration

class ApiSimulation : Simulation() {

    private val baseUrl = System.getenv("BASE_URL") ?: "http://localhost:8080"

    private val httpProtocol = http
        .baseUrl(baseUrl)
        .acceptHeader("application/json")
        .contentTypeHeader("application/json")

    private val healthCheck = scenario("Health check")
        .exec(
            http("GET /health")
                .get("/health")
                .check(status().`is`(200))
        )

    private val readWorkload = scenario("Read workload")
        .exec(
            http("GET /hello")
                .get("/hello")
                .check(status().`is`(200))
        )

    init {
        setUp(
            healthCheck.inject(
                rampUsers(20).during(Duration.ofSeconds(5))
            ),
            readWorkload.inject(
                rampUsers(50).during(Duration.ofSeconds(10)),
                constantUsersPerSec(10.0).during(Duration.ofSeconds(20))
            )
        )
            .protocols(httpProtocol)
            .assertions(
                global().responseTime().percentile(95).lt(500),
                global().failedRequests().percent().lt(1.0)
            )
    }
}
