import { createClient } from "@supabase/supabase-js";

export interface WebAuthSession {
  accessToken: string;
}

export interface AuthGateway {
  subscribe(listener: (session?: WebAuthSession) => void): () => void;
  sendMagicLink(email: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  setupNeeded?(): Promise<boolean>;
  setupAccount?(email: string, password: string, displayName: string): Promise<void>;
  signInWithPassword?(email: string, password: string): Promise<void>;
}

export interface AuthConfiguration {
  url?: string;
  publicKey?: string;
  origin: string;
  allowDemo: boolean;
  allowSelfhost?: boolean;
}

interface AuthSessionLike {
  access_token: string;
}

interface AuthClientLike {
  auth: {
    onAuthStateChange(
      listener: (event: string, session: AuthSessionLike | null) => void
    ): { data: { subscription: { unsubscribe(): void } } };
    signInWithOtp(input: {
      email: string;
      options: { emailRedirectTo: string };
    }): Promise<{ error: Error | null }>;
    signInWithOAuth(input: {
      provider: "google";
      options: { redirectTo: string };
    }): Promise<{ error: Error | null }>;
    signOut(): Promise<{ error: Error | null }>;
  };
}

export interface AuthDependencies {
  createClient?: (url: string, publicKey: string, options: unknown) => AuthClientLike;
  demoStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  fetchImpl?: typeof fetch;
}

export class AuthConfigurationError extends Error {
  constructor() {
    super("Sign-in is not configured for this deployment.");
  }
}

const hostedStudioCallback = "https://f-motion.com/studio";

/**
 * Magic-link / OAuth return URL. Hosted and local studio live at /studio.
 * /app/ remains a redirect for older links.
 */
export function studioOrigin(href: string): string {
  const url = new URL(href);
  if (
    url.hostname === "f-motion.com"
    || url.hostname.endsWith(".f-motion.com")
    || url.hostname.endsWith(".f-motion.pages.dev")
  ) {
    return hostedStudioCallback;
  }
  return new URL("/studio", url).href;
}

/** Supabase puts expired-link failures on the query, the hash, or both. */
export function authCallbackError(href: string): string | undefined {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  return url.searchParams.get("error_code")
    ?? url.searchParams.get("error")
    ?? hash.get("error_code")
    ?? hash.get("error")
    ?? undefined;
}

function callbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/`;
}

function throwAuthError(error: Error | null): void {
  if (error) throw error;
}

class SupabaseAuthGateway implements AuthGateway {
  private readonly client: AuthClientLike;
  private readonly redirectTo: string;

  constructor(client: AuthClientLike, redirectTo: string) {
    this.client = client;
    this.redirectTo = redirectTo;
  }

  subscribe(listener: (session?: WebAuthSession) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        listener(undefined);
        return;
      }
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        listener(session?.access_token ? { accessToken: session.access_token } : undefined);
      }
    });
    return () => data.subscription.unsubscribe();
  }

  async sendMagicLink(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: this.redirectTo }
    });
    throwAuthError(error);
  }

  async signInWithGoogle(): Promise<void> {
    const { error } = await this.client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: this.redirectTo }
    });
    throwAuthError(error);
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    throwAuthError(error);
  }
}

class SelfhostAuthGateway implements AuthGateway {
  private readonly marker = "fengine-selfhost-session";
  private readonly tokenKey = "fengine-selfhost-token";
  private readonly listeners = new Set<(session?: WebAuthSession) => void>();
  private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  private readonly fetchImpl?: typeof fetch;

  constructor(
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    fetchImpl?: typeof fetch
  ) {
    this.storage = storage;
    this.fetchImpl = fetchImpl;
  }

  private request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return this.fetchImpl ? this.fetchImpl(input, init) : fetch(input, init);
  }

  private current(): WebAuthSession | undefined {
    const token = this.storage.getItem(this.tokenKey);
    return this.storage.getItem(this.marker) === "1" && token ? { accessToken: token } : undefined;
  }

  private remember(token: string): void {
    this.storage.setItem(this.marker, "1");
    this.storage.setItem(this.tokenKey, token);
    for (const listener of this.listeners) listener({ accessToken: token });
  }

  private async readError(response: Response, fallback: string): Promise<string> {
    try {
      const body = await response.json() as { message?: unknown };
      if (typeof body.message === "string" && body.message) return body.message;
    } catch {
      // keep fallback
    }
    return fallback;
  }

  private async postAccount(path: string, email: string, password: string, displayName?: string): Promise<void> {
    const response = await this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        password,
        ...(displayName !== undefined ? { display_name: displayName.trim() } : {})
      })
    });
    if (!response.ok) throw new Error(await this.readError(response, "Sign-in failed."));
    const body = await response.json() as { access_token?: unknown };
    if (typeof body.access_token !== "string" || !body.access_token) throw new Error("Sign-in failed.");
    this.remember(body.access_token);
  }

  subscribe(listener: (session?: WebAuthSession) => void): () => void {
    this.listeners.add(listener);
    queueMicrotask(() => {
      if (this.listeners.has(listener)) listener(this.current());
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  async setupNeeded(): Promise<boolean> {
    const response = await this.request("/api/setup");
    if (!response.ok) throw new Error("Could not check this install.");
    const body = await response.json() as { needed?: unknown };
    return body.needed === true;
  }

  async setupAccount(email: string, password: string, displayName: string): Promise<void> {
    await this.postAccount("/api/setup", email, password, displayName);
  }

  async signInWithPassword(email: string, password: string): Promise<void> {
    await this.postAccount("/api/auth/login", email, password);
  }

  async sendMagicLink(): Promise<void> {
    throw new Error("Self-host sign-in uses your email and password.");
  }

  async signInWithGoogle(): Promise<void> {
    throw new Error("Self-host sign-in uses your email and password.");
  }

  async signOut(): Promise<void> {
    const token = this.storage.getItem(this.tokenKey);
    this.storage.removeItem(this.marker);
    this.storage.removeItem(this.tokenKey);
    if (token) {
      await this.request("/api/auth/logout", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` }
      }).catch(() => undefined);
    }
    for (const listener of this.listeners) listener(undefined);
  }
}

class DemoAuthGateway implements AuthGateway {
  private readonly marker = "fengine-demo-session";
  private readonly listeners = new Set<(session?: WebAuthSession) => void>();
  private readonly token = `local-demo-${crypto.randomUUID()}`;
  private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;

  constructor(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
    this.storage = storage;
  }

  subscribe(listener: (session?: WebAuthSession) => void): () => void {
    this.listeners.add(listener);
    queueMicrotask(() => {
      if (this.listeners.has(listener)) {
        listener(this.storage.getItem(this.marker) === "1" ? { accessToken: this.token } : undefined);
      }
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  private signInLocal(): void {
    this.storage.setItem(this.marker, "1");
    for (const listener of this.listeners) listener({ accessToken: this.token });
  }

  async sendMagicLink(): Promise<void> {
    this.signInLocal();
  }

  async signInWithGoogle(): Promise<void> {
    this.signInLocal();
  }

  async signOut(): Promise<void> {
    this.storage.removeItem(this.marker);
    for (const listener of this.listeners) listener(undefined);
  }
}

function sessionStorageOr(dependencies: AuthDependencies): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  return dependencies.demoStorage
    ?? (typeof sessionStorage === "undefined" ? undefined : sessionStorage);
}

export function createAuthGateway(
  config: AuthConfiguration,
  dependencies: AuthDependencies = {}
): AuthGateway {
  const url = config.url?.trim();
  const publicKey = config.publicKey?.trim();

  if (config.allowSelfhost) {
    const storage = sessionStorageOr(dependencies);
    if (!storage) throw new AuthConfigurationError();
    return new SelfhostAuthGateway(storage, dependencies.fetchImpl);
  }

  if (Boolean(url) !== Boolean(publicKey)) throw new AuthConfigurationError();

  if (url && publicKey) {
    const factory = dependencies.createClient
      ?? ((clientUrl: string, key: string, options: unknown) =>
        createClient(clientUrl, key, options as never) as unknown as AuthClientLike);
    const client = factory(url, publicKey, {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true
      }
    });
    return new SupabaseAuthGateway(client, callbackUrl(config.origin));
  }

  if (!config.allowDemo) throw new AuthConfigurationError();
  const storage = sessionStorageOr(dependencies);
  if (!storage) throw new AuthConfigurationError();
  return new DemoAuthGateway(storage);
}
