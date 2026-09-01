/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_ACCESS_TOKEN: string
  readonly VITE_FULLCAM_SUBSCRIPTION_KEY?: string
  readonly VITE_API_PROXY_URL: string
  readonly VITE_GEOSCAPE_API_KEY?: string
  readonly VITE_SILO_API_USERNAME?: string
  readonly VITE_SILO_API_PASSWORD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
