/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ALLOW_DEMO_AUTH?: string;
  readonly VITE_ENABLE_GOOGLE_AUTH?: string;
  /** Exact partner account email that may see Pexels / FAL / Fotium sources. */
  readonly VITE_PARTNER_BRAND_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
