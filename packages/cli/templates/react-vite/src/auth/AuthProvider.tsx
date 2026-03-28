{{#IF_KEYCLOAK}}
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import keycloak from './keycloak';

interface AuthUser {
  name: string;
  email: string;
  roles: string[];
}

interface AuthContextType {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
  hasRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    keycloak
      .init({
        onLoad: 'check-sso',
        silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
        pkceMethod: 'S256',
      })
      .then((authenticated) => {
        if (authenticated && keycloak.token && keycloak.tokenParsed) {
          setToken(keycloak.token);
          setUser({
            name: keycloak.tokenParsed.name ?? keycloak.tokenParsed.preferred_username ?? '',
            email: keycloak.tokenParsed.email ?? '',
            roles: keycloak.tokenParsed.realm_access?.roles ?? [],
          });
        }
      })
      .finally(() => setIsLoading(false));

    keycloak.onTokenExpired = () => {
      keycloak.updateToken(30).then((refreshed) => {
        if (refreshed && keycloak.token && keycloak.tokenParsed) {
          setToken(keycloak.token);
          setUser((prev) =>
            prev
              ? { ...prev, roles: keycloak.tokenParsed?.realm_access?.roles ?? [] }
              : null
          );
        }
      });
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isLoading,
        login: () => keycloak.login(),
        logout: () => keycloak.logout({ redirectUri: window.location.origin }),
        hasRole: (role) => user?.roles.includes(role) ?? false,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
{{/IF_KEYCLOAK}}
