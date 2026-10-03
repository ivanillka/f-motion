const PENDING_KEY = "fengine-pending-project";
const projectIdPattern = /^[0-9a-f-]{36}$/i;

export function isImportedProjectId(value: string): boolean {
  return projectIdPattern.test(value);
}

type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Remember ?project= so magic-link redirects that drop the query can still open the draft. */
export function rememberImportedProject(
  href: string,
  storage: PendingStorage,
  mirror?: PendingStorage
): string {
  const fromUrl = new URL(href).searchParams.get("project") ?? "";
  if (isImportedProjectId(fromUrl)) {
    storage.setItem(PENDING_KEY, fromUrl);
    mirror?.setItem(PENDING_KEY, fromUrl);
    return fromUrl;
  }
  const pending = storage.getItem(PENDING_KEY) || mirror?.getItem(PENDING_KEY) || "";
  if (!isImportedProjectId(pending)) return "";
  storage.setItem(PENDING_KEY, pending);
  return pending;
}

export function clearImportedProject(storage: Pick<Storage, "removeItem">, mirror?: Pick<Storage, "removeItem">): void {
  storage.removeItem(PENDING_KEY);
  mirror?.removeItem(PENDING_KEY);
}

/** Edit of an imported draft must keep that project. A new video is the only create path. */
export function storyboardProjectAction(editLock: boolean, importedId: string): "reuse" | "create" {
  return editLock && isImportedProjectId(importedId) ? "reuse" : "create";
}
