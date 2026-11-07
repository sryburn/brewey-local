/** Browser-safe presentation and debugging configuration. */
export interface AppConfig {
  app: { environment: 'development' | 'production' }
  debug: {
    enabled: boolean
    enableConsoleDebug: boolean
    enableLocalStorage: boolean
    enableDownloads: boolean
    includeToolData: boolean
  }
}
const debugEnabled = process.env.NEXT_PUBLIC_ENABLE_DEBUG === 'true'
export const config: AppConfig = {
  app: { environment: process.env.NODE_ENV === 'development' ? 'development' : 'production' },
  debug: { enabled: true, enableConsoleDebug: debugEnabled, enableLocalStorage: false, enableDownloads: true, includeToolData: debugEnabled },
}
export const isDevelopment = config.app.environment === 'development'
export const isProduction = config.app.environment === 'production'
