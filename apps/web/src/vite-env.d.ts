/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ALLOW_DEMO_AUTH?: string;
  readonly VITE_ENABLE_GOOGLE_AUTH?: string;
  readonly VITE_SELFHOST_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
