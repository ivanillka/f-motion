import { createClient } from "@supabase/supabase-js";

export interface WebAuthSession {
  accessToken: string;
}

export interface AuthGateway {
  subscribe(listener: (session?: WebAuthSession) => void): () => void;
  sendMagicLink(email: string): Promise<void>;
  /** Completes email OTP when the magic-link redirect is owned by Fotium. */
  verifyEmailOtp(email: string, token: string): Promise<void>;
  /**
   * Completes PKCE when the email link lands on Fotium (`?code=`) or a copied
   * Supabase verify URL. Must run in the same browser that requested the link.
   */
  completeAuthCallback(linkOrCode: string): Promise<void>;
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

type EmailOtpType = "email" | "magiclink" | "signup" | "invite" | "recovery" | "email_change";

interface AuthClientLike {
  auth: {
    onAuthStateChange(
      listener: (event: string, session: AuthSessionLike | null) => void
    ): { data: { subscription: { unsubscribe(): void } } };
    signInWithOtp(input: {
      email: string;
      options: { emailRedirectTo: string };
    }): Promise<{ error: Error | null }>;
    exchangeCodeForSession(authCode: string): Promise<{ error: Error | null }>;
    verifyOtp(input:
      | { email: string; token: string; type: EmailOtpType }
      | { token_hash: string; type: EmailOtpType }
    ): Promise<{ error: Error | null }>;
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

/**
 * Magic-link return origin. Shared Fotium Supabase allowlists site roots
 * (`https://f-motion.com/`), not `/app/`. Marketing `/` forwards `?code=` to the studio.
 */
export function studioOrigin(href: string): string {
  return new URL("/", new URL(href)).href;
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

function otpType(value: string | null): EmailOtpType {
  const allowed: EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery", "email_change"];
  return allowed.includes(value as EmailOtpType) ? value as EmailOtpType : "magiclink";
}

const uuidCode = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Parse a Fotium/F-Motion `?code=` URL, a Supabase verify URL, or a raw auth code. */
export function parseAuthCallback(linkOrCode: string):
  | { kind: "pkce"; code: string }
  | { kind: "otp"; token_hash: string; type: EmailOtpType } {
  const raw = linkOrCode.trim();
  if (!raw) throw new Error("Login link is empty");

  if (uuidCode.test(raw)) return { kind: "pkce", code: raw };

  try {
    const url = new URL(raw);
    const code = url.searchParams.get("code");
    if (code) return { kind: "pkce", code };
    const tokenHash = url.searchParams.get("token")
      ?? url.searchParams.get("token_hash")
      ?? "";
    if (!tokenHash) throw new Error("Login link is missing a code");
    return { kind: "otp", token_hash: tokenHash, type: otpType(url.searchParams.get("type")) };
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Login link is invalid");
    throw error;
  }
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

  async verifyEmailOtp(email: string, token: string): Promise<void> {
    const code = token.trim();
    if (!/^\d{6,8}$/.test(code)) throw new Error("Enter the 6-digit code from the email");
    const { error } = await this.client.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: "email"
    });
    throwAuthError(error);
  }

  async completeAuthCallback(linkOrCode: string): Promise<void> {
    const parsed = parseAuthCallback(linkOrCode);
    if (parsed.kind === "pkce") {
      const { error } = await this.client.auth.exchangeCodeForSession(parsed.code);
      throwAuthError(error);
      return;
    }
    const attempts: EmailOtpType[] = parsed.type === "email" ? ["email"] : [parsed.type, "email"];
    let lastError: Error | null = null;
    for (const type of attempts) {
      const { error } = await this.client.auth.verifyOtp({ token_hash: parsed.token_hash, type });
      if (!error) return;
      lastError = error;
    }
    throwAuthError(lastError);
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

  private signInLocal(): void {
    this.storage.setItem(this.marker, "1");
    for (const listener of this.listeners) listener({ accessToken: this.token });
  }

  async sendMagicLink(): Promise<void> {
    this.signInLocal();
  }

  async verifyEmailOtp(): Promise<void> {
    this.signInLocal();
  }

  async completeAuthCallback(): Promise<void> {
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
