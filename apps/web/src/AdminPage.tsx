import { useEffect, useMemo, useRef, useState } from "react";
import { ApiClient, type ProjectSummary } from "./api";
import { AuthConfigurationError, createAuthGateway, studioOrigin } from "./auth";
import "./style.css";

function go(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function AdminPage() {
  const authSetup = useMemo(() => {
    try {
      return {
        gateway: createAuthGateway({
          url: import.meta.env.VITE_SUPABASE_URL,
          publicKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          origin: studioOrigin(location.href),
          allowDemo: Boolean(import.meta.env.DEV) || import.meta.env.VITE_ALLOW_DEMO_AUTH === "1",
          allowSelfhost: import.meta.env.VITE_SELFHOST_AUTH === "1"
        })
      };
    } catch (error) {
      return { error: error instanceof Error ? error : new AuthConfigurationError() };
    }
  }, []);
  const tokenRef = useRef("");
  const api = useMemo(() => new ApiClient(() => tokenRef.current, () => go("/login")), []);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [status, setStatus] = useState("Loading…");

  useEffect(() => {
    if (!authSetup.gateway) {
      setStatus("Sign-in is not configured.");
      return;
    }
    return authSetup.gateway.subscribe((session) => {
      if (!session) {
        go("/login");
        return;
      }
      tokenRef.current = session.accessToken;
      void api.listProjects()
        .then(({ projects: rows }) => {
          setProjects(rows);
          setStatus(rows.length ? "" : "No projects yet.");
        })
        .catch(() => setStatus("Projects could not be loaded."));
    });
  }, [api, authSetup.gateway]);

  return (
    <div className="app-shell login-shell">
      <div className="app-stage">
        <section className="login-card" aria-labelledby="admin-heading">
          <p className="login-kicker"><a href="/studio">Studio</a> · Admin</p>
          <h1 id="admin-heading">Projects</h1>
          <p>Open a draft in the editor. Cube create stays on /studio.</p>
          {projects.map((item) =>
            <button key={item.id} className="secondary" type="button" onClick={() => go(`/studio/edit?project=${item.id}`)}>
              {item.brief.purpose || "Untitled"} · r{item.revision}
            </button>)}
          <p role="status">{status}</p>
          <a href="/studio">Back to cube</a>
        </section>
      </div>
    </div>
  );
}
