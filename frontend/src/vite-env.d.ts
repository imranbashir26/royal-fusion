/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_SANITY_PROJECT_ID?: string
  readonly VITE_SANITY_DATASET?: string
  readonly VITE_SANITY_API_VERSION?: string
  readonly VITE_ENABLE_SANITY_BLOGS?: string
  readonly VITE_ENABLE_BLOG_HTML?: string
  readonly VITE_BLOG_CANONICAL_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
