export const DEFAULT_CURSOR_HOST_SUFFIXES = [".cursor.sh", ".cursor.com", ".cursorapi.com"];
export const DEFAULT_CURSOR_HOSTS = ["cursor.sh", "cursor.com", "cursorapi.com"];
export const DEFAULT_CODEX_HOSTS = ["openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com"];
export const DEFAULT_CODEX_HOST_SUFFIXES = DEFAULT_CODEX_HOSTS.map((host) => `.${host}`);
// VS Code downloads the official Codex extension through these endpoints.
export const DEFAULT_EXTENSION_HOSTS = ["marketplace.visualstudio.com"];
export const DEFAULT_EXTENSION_HOST_SUFFIXES = [".gallery.vsassets.io", ".gallerycdn.vsassets.io"];

export function normalizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

export function hostAllowed(host, options = {}) {
  const name = normalizeHost(host);
  if (!name) return false;
  const hosts = options.hosts || [...DEFAULT_CURSOR_HOSTS, ...DEFAULT_CODEX_HOSTS, ...DEFAULT_EXTENSION_HOSTS];
  const suffixes = options.suffixes || [...DEFAULT_CURSOR_HOST_SUFFIXES, ...DEFAULT_CODEX_HOST_SUFFIXES, ...DEFAULT_EXTENSION_HOST_SUFFIXES];
  if (hosts.includes(name)) return true;
  return suffixes.some((suffix) => name.endsWith(suffix));
}
