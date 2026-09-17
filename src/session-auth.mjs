import { join } from "node:path";
import { protectDpapiText, unprotectDpapiText } from "./release-key.mjs";

const REFRESH_FILE = "matrix-refresh.dpapi";

export function protectSessionRefreshToken(session, secretsDir) {
  if (!session?.refresh_token) return { ...session };
  protectDpapiText(session.refresh_token, join(secretsDir, REFRESH_FILE));
  const { refresh_token: _removed, ...safe } = session;
  return { ...safe, refresh_token_dpapi: REFRESH_FILE };
}

export function loadSessionRefreshToken(session, secretsDir) {
  if (session?.refresh_token) return String(session.refresh_token);
  if (!session?.refresh_token_dpapi) return "";
  return unprotectDpapiText(join(secretsDir, session.refresh_token_dpapi));
}

export async function refreshSession(session, options) {
  const refreshToken = options.loadRefreshToken(session);
  if (!refreshToken) throw new Error("Matrix refresh token unavailable");
  if (!session.token_endpoint || !session.client_id) throw new Error("Matrix OIDC refresh configuration missing");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: session.client_id,
  }).toString();
  const response = await options.fetchFn(session.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Matrix token refresh ${response.status} ${text.slice(0, 200)}`);
  const tokens = JSON.parse(text);
  if (!tokens.access_token) throw new Error("Matrix token refresh returned no access_token");
  const nextRefresh = tokens.refresh_token || refreshToken;
  const refreshPath = options.protectRefreshToken(nextRefresh);
  const { refresh_token: _removed, ...safe } = session;
  return {
    ...safe,
    access_token: tokens.access_token,
    refresh_token_dpapi: refreshPath || session.refresh_token_dpapi || REFRESH_FILE,
    expires_at: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : session.expires_at,
  };
}
