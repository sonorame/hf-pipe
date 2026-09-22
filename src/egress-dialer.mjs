export const DEFAULT_CURSOR_HOST_SUFFIXES = [".cursor.sh", ".cursor.com", ".cursorapi.com"];
export const DEFAULT_CURSOR_HOSTS = ["cursor.sh", "cursor.com", "cursorapi.com"];

export function normalizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

export function hostAllowed(host, options = {}) {
  const name = normalizeHost(host);
  if (!name) return false;
  const hosts = options.hosts || DEFAULT_CURSOR_HOSTS;
  const suffixes = options.suffixes || DEFAULT_CURSOR_HOST_SUFFIXES;
  if (hosts.includes(name)) return true;
  return suffixes.some((suffix) => name.endsWith(suffix));
}
