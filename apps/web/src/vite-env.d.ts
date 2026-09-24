/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ALLOW_DEMO_AUTH?: string;
  readonly VITE_ENABLE_GOOGLE_AUTH?: string;
  /** Exact partner account email that may see Pexels / FAL / partner gallery sources. */
  readonly VITE_PARTNER_BRAND_EMAIL?: string;
  readonly VITE_PARTNER_GALLERY_URL?: string;
  readonly VITE_PARTNER_GALLERY_NAME?: string;
  readonly VITE_GITHUB_REPO_SLUG?: string;
  readonly VITE_SELFHOST_AUTH?: string;
  readonly VITE_STUDIO_COMING_SOON?: string;
  readonly VITE_GIT_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
