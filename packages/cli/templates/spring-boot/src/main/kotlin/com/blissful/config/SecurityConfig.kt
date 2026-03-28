{{#IF_KEYCLOAK}}
package com.blissful.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter
import org.springframework.security.web.SecurityFilterChain

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
class SecurityConfig {

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        http
            .authorizeHttpRequests { auth ->
                auth
                    .requestMatchers("/actuator/health").permitAll()
                    .requestMatchers("/actuator/**").hasRole("admin")
                    .anyRequest().authenticated()
            }
            .oauth2ResourceServer { oauth2 ->
                oauth2.jwt { jwt ->
                    jwt.jwtAuthenticationConverter(keycloakJwtConverter())
                }
            }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .csrf { it.disable() }
        return http.build()
    }

    /**
     * Keycloak stores roles in `realm_access.roles` rather than the standard
     * Spring Security `scope` or `authorities` claim, so we map them manually.
     */
    private fun keycloakJwtConverter(): JwtAuthenticationConverter {
        val converter = JwtAuthenticationConverter()
        converter.setJwtGrantedAuthoritiesConverter { jwt ->
            @Suppress("UNCHECKED_CAST")
            val realmAccess = jwt.getClaim<Map<String, Any>>("realm_access")
            val roles = (realmAccess?.get("roles") as? List<*>) ?: emptyList<String>()
            roles.filterIsInstance<String>()
                .map { SimpleGrantedAuthority("ROLE_$it") }
        }
        return converter
    }
}
{{/IF_KEYCLOAK}}
