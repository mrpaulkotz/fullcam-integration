/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_ACCESS_TOKEN: string
  readonly VITE_FULLCAM_SUBSCRIPTION_KEY?: string
  readonly VITE_API_PROXY_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
