import { useEffect, useMemo, useState } from "react";
import { AuthConfigurationError, authCallbackError, createAuthGateway, studioOrigin } from "./auth";
import "./style.css";

function goStudio(project?: string): void {
  const next = new URL(project ? "/studio/edit" : "/studio", location.origin);
  if (project) next.searchParams.set("project", project);
  history.replaceState(null, "", `${next.pathname}${next.search}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function LoginPage({ comingSoon = false }: { comingSoon?: boolean }) {
  const authSetup = useMemo(() => {
    try {
      return {
        gateway: createAuthGateway({
          url: import.meta.env.VITE_SUPABASE_URL,
          publicKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          origin: studioOrigin(location.href),
          allowDemo: Boolean(import.meta.env.DEV) || import.meta.env.VITE_ALLOW_DEMO_AUTH === "1"
        })
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error : new AuthConfigurationError()
      };
    }
  }, []);
  const [email, setEmail] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [awaitingEmail, setAwaitingEmail] = useState(false);
  const [status, setStatus] = useState("");
  const pendingProject = new URL(location.href).searchParams.get("project") ?? "";

  useEffect(() => {
    if (!authSetup.gateway) {
      setStatus(authSetup.error instanceof AuthConfigurationError
        ? authSetup.error.message
        : "Sign-in is not configured for this deployment.");
      return;
    }
    const pendingExpired = authCallbackError(location.href);
    if (pendingExpired) {
      const cleaned = new URL(location.href);
      cleaned.searchParams.delete("error_code");
      cleaned.searchParams.delete("error");
      history.replaceState(null, "", `${cleaned.pathname}${cleaned.search}`);
    }
    return authSetup.gateway.subscribe((session) => {
      if (!session) {
        if (pendingExpired) setStatus(pendingExpired);
        return;
      }
      const callback = new URL(location.href);
      if (callback.searchParams.has("code")) {
        callback.searchParams.delete("code");
        history.replaceState(null, "", `${callback.pathname}${callback.search}${callback.hash}`);
      }
      goStudio(pendingProject || undefined);
    });
  }, [authSetup.error, authSetup.gateway, pendingProject]);

  async function magicLink() {
    if (!authSetup.gateway) return;
    setAuthBusy(true);
    try {
      await authSetup.gateway.sendMagicLink(email);
      if (import.meta.env.DEV || import.meta.env.VITE_ALLOW_DEMO_AUTH === "1") {
        setStatus("");
        setAwaitingEmail(false);
      } else {
        setAwaitingEmail(true);
        setStatus("Check your email and open the link. It should return to this studio.");
      }
    } catch {
      setStatus("Sign-in link could not be sent.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function googleSignIn() {
    if (!authSetup.gateway) return;
    setAuthBusy(true);
    try {
      await authSetup.gateway.signInWithGoogle();
    } catch {
      setStatus("Google sign-in could not be started.");
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <div className="app-shell login-shell">
      <div className="app-stage">
        <section className="login-card" aria-labelledby="login-heading">
          <p className="login-kicker"><a href="/">F-Motion</a></p>
          <h1 id="login-heading">{comingSoon ? "Login" : "Shape a vertical video"}</h1>
          {comingSoon ? (
            <>
              <p>The hosted studio is not open yet.</p>
              <p>Read the <a href="/self-host">self-host guide</a> or go back to <a href="/">home</a>.</p>
            </>
          ) : (
            <>
              <p>{/^[0-9a-f-]{36}$/i.test(pendingProject)
                ? "Sign in to open the imported draft."
                : "Sign in to keep projects private."}</p>
              <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <button
                disabled={authBusy || !authSetup.gateway || (Boolean(import.meta.env.VITE_SUPABASE_URL) && !email.trim())}
                onClick={() => void magicLink()}
              >
                Email me a magic link
              </button>
              {Boolean(import.meta.env.VITE_SUPABASE_URL) && (
                <p>{awaitingEmail
                  ? "Email sent. Open the link to finish sign-in on this studio."
                  : "Open the email link to finish sign-in."}</p>
              )}
              {import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "1" ? (
                <button className="secondary" disabled={authBusy || !authSetup.gateway} onClick={() => void googleSignIn()}>
                  Continue with Google
                </button>
              ) : null}
              <p role="status">{status}</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
