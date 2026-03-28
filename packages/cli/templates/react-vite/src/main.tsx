import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
{{#IF_KEYCLOAK}}import { AuthProvider } from './auth/AuthProvider'
{{/IF_KEYCLOAK}}import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {{#IF_KEYCLOAK}}<AuthProvider>
          {{/IF_KEYCLOAK}}<App />{{#IF_KEYCLOAK}}
        </AuthProvider>{{/IF_KEYCLOAK}}
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
