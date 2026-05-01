export interface DashboardConfig {
  apiBase: string
  serviceHost: string
}

const DEFAULTS: DashboardConfig = {
  apiBase: '/api/v1',
  serviceHost: 'http://localhost',
}

let current: DashboardConfig = DEFAULTS

export function getConfig(): DashboardConfig {
  return current
}

export async function loadConfig(): Promise<DashboardConfig> {
  try {
    const res = await fetch('/config.json', { cache: 'no-cache' })
    if (!res.ok) return current
    const data = (await res.json()) as Partial<DashboardConfig>
    current = { ...DEFAULTS, ...data }
  } catch {
    // Keep defaults if config.json is missing or malformed
  }
  return current
}

export function serviceUrl(port: number | string): string {
  return `${current.serviceHost}:${port}`
}
