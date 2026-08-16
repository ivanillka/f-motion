const PENDING_KEY = "fengine-pending-project";
const projectIdPattern = /^[0-9a-f-]{36}$/i;

export function isImportedProjectId(value: string): boolean {
  return projectIdPattern.test(value);
}

/** Remember ?project= so magic-link redirects that drop the query can still open the draft. */
export function rememberImportedProject(
  href: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">
): string {
  const fromUrl = new URL(href).searchParams.get("project") ?? "";
  if (isImportedProjectId(fromUrl)) {
    storage.setItem(PENDING_KEY, fromUrl);
    return fromUrl;
  }
  const pending = storage.getItem(PENDING_KEY) ?? "";
  return isImportedProjectId(pending) ? pending : "";
}

export function clearImportedProject(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(PENDING_KEY);
}
