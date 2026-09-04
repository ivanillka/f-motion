/** ponytail: set VITE_GITHUB_REPO_SLUG at build for forks. */
const slug = (import.meta.env.VITE_GITHUB_REPO_SLUG ?? "ivanillka/f-motion").trim();
const ref = "advisor/133-design-contract";
export const GITHUB_REPO_URL = `https://github.com/${slug}`;
export const githubBlobUrl = (path: string, branch = ref) =>
  `${GITHUB_REPO_URL}/blob/${branch}/${path.replace(/^\//, "")}`;
export const githubTreeUrl = (path: string, branch = ref) =>
  `${GITHUB_REPO_URL}/tree/${branch}/${path.replace(/^\//, "")}`;
