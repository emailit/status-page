/**
 * Minimal cookie-based admin auth.
 *
 * A signed session token is issued on login (HMAC of a fixed payload using the
 * admin password as the key). No DB needed; the token is valid as long as the
 * password is unchanged.
 */
const COOKIE_NAME = "sp_admin";
const SESSION_PAYLOAD = "admin-session-v1";

async function hmac(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function makeToken(password) {
  return hmac(password, SESSION_PAYLOAD);
}

export async function verifyPassword(env, password) {
  if (!env.ADMIN_PASSWORD) return false;
  return timingSafeEqual(String(password ?? ""), String(env.ADMIN_PASSWORD));
}

function parseCookies(req) {
  const header = req.headers.get("Cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export async function isAuthenticated(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  const expected = await makeToken(env.ADMIN_PASSWORD);
  return timingSafeEqual(token, expected);
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=604800`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}
