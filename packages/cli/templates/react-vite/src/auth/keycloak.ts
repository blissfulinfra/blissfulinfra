{{#IF_KEYCLOAK}}
import Keycloak from 'keycloak-js';

const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8001',
  realm: import.meta.env.VITE_KEYCLOAK_REALM ?? '{{PROJECT_NAME}}',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'frontend',
});

export default keycloak;
{{/IF_KEYCLOAK}}
