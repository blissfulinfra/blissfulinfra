{{#IF_KEYCLOAK}}
import Keycloak from 'keycloak-js';

// VITE_* env vars are baked in at build time. Override via Docker build
// args / a .env.production file when the client's allocated Keycloak port
// differs from the default base (8050).
const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8050',
  realm: import.meta.env.VITE_KEYCLOAK_REALM ?? '{{KEYCLOAK_REALM}}',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? '{{CLIENT_NAME}}-default',
});

export default keycloak;
{{/IF_KEYCLOAK}}
