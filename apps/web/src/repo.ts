/** ponytail: set VITE_GITHUB_REPO_SLUG at build for forks; defaults to OWNER/f-motion. */
const slug = (import.meta.env.VITE_GITHUB_REPO_SLUG ?? "OWNER/f-motion").trim();
export const GITHUB_REPO_URL = `https://github.com/${slug}`;
export const githubBlobUrl = (path: string, branch = "main") =>
  `${GITHUB_REPO_URL}/blob/${branch}/${path.replace(/^\//, "")}`;
