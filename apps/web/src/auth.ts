import { createClient } from "@supabase/supabase-js";

export interface WebAuthSession {
  accessToken: string;
}

export interface AuthGateway {
  subscribe(listener: (session?: WebAuthSession) => void): () => void;
  sendMagicLink(email: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}

export interface AuthConfiguration {
  url?: string;
  publicKey?: string;
  origin: string;
  allowDemo: boolean;
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
}

export class AuthConfigurationError extends Error {
  constructor() {
    super("Sign-in is not configured for this deployment.");
  }
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

  async sendMagicLink(): Promise<void> {
    this.storage.setItem(this.marker, "1");
    for (const listener of this.listeners) listener({ accessToken: this.token });
  }

  async signInWithGoogle(): Promise<void> {
    await this.sendMagicLink();
  }

  async signOut(): Promise<void> {
    this.storage.removeItem(this.marker);
    for (const listener of this.listeners) listener(undefined);
  }
}

export function createAuthGateway(
  config: AuthConfiguration,
  dependencies: AuthDependencies = {}
): AuthGateway {
  const url = config.url?.trim();
  const publicKey = config.publicKey?.trim();
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
  const storage = dependencies.demoStorage
    ?? (typeof sessionStorage === "undefined" ? undefined : sessionStorage);
  if (!storage) throw new AuthConfigurationError();
  return new DemoAuthGateway(storage);
}
