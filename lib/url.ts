// URL helpers: unwrap login redirects, strip anything token-like before a URL
// leaves the browser, and build keys for duplicate detection. Pure functions,
// no browser APIs, so they can be unit-tested in Node.

/** Query params that commonly carry the real destination of a login page. */
const REDIRECT_PARAMS = [
  'redirect_url',
  'redirecturl',
  'redirect_uri',
  'redirectto',
  'redirect',
  'next_url',
  'next',
  'return_to',
  'returnto',
  'returnurl',
  'return_url',
  'continue',
  'dest',
  'destination',
  'target',
  'callbackurl',
  'goto',
];

/** Query params whose values are credentials or one-time secrets. Always dropped. */
const SENSITIVE_PARAMS = new Set([
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'auth',
  'authorization',
  'code',
  'state',
  'nonce',
  'meta',
  'kid',
  'sig',
  'signature',
  'key',
  'apikey',
  'api_key',
  'secret',
  'client_secret',
  'password',
  'pwd',
  'session',
  'sessionid',
  'sid',
  'jwt',
  'otp',
  'ticket',
  'samlresponse',
  'samlrequest',
  'relaystate',
  'tuuid',
  'invitation_token',
]);

const JWT_RE = /^eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*$/;
// A long run of URL-safe characters with no separators looks like a token or hash.
const OPAQUE_RE = /^[A-Za-z0-9_\-+/=.~%]{41,}$/;

const MAX_PARAM_VALUE = 60;
const MAX_FRAGMENT = 80;

export interface CleanedUrl {
  /** The URL safe to show Claude: tokens stripped, long values trimmed. */
  url: string;
  /** Set when `url` was a login/SSO page: the cleaned URL it will redirect to. */
  destination?: string;
  /** True when the tab is a login wall (its page text is not useful context). */
  isLoginWall: boolean;
}

function safeParse(raw: string, base?: string): URL | undefined {
  try {
    return new URL(raw, base);
  } catch {
    return undefined;
  }
}

/** Decode repeatedly to undo double encoding such as `https%253A%252F%252F`. */
function fullyDecode(value: string): string {
  let current = value;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return current;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

function looksSecret(value: string): boolean {
  return JWT_RE.test(value) || OPAQUE_RE.test(value);
}

function isHttp(u: URL): boolean {
  return u.protocol === 'http:' || u.protocol === 'https:';
}

const LOGIN_PATH_RE = /(^|\/)(login|log-in|signin|sign-in|sign_in|sso|oauth2?|authorize|auth)(\/|\.html?$|$)/i;
const LOGIN_HOST_RE = /^(auth|login|sso|accounts?|id|identity|authentication)\./i;

/**
 * If `u` is a login page that carries its destination in a query parameter,
 * return that destination as an absolute URL.
 */
export function unwrapRedirect(u: URL): URL | undefined {
  for (const [name, rawValue] of u.searchParams) {
    if (!REDIRECT_PARAMS.includes(name.toLowerCase())) continue;
    const value = fullyDecode(rawValue).trim();
    if (!value) continue;

    let base = u.origin;
    // Cloudflare Access: /cdn-cgi/access/login/<app-host>?redirect_url=/path
    const cf = u.pathname.match(/\/cdn-cgi\/access\/login\/([^/?#]+)/);
    if (cf) base = `https://${cf[1]}`;

    const target = safeParse(value, base);
    if (!target || !isHttp(target)) continue;
    // Single-page apps keep their route in the outer URL's fragment
    // (e.g. `...&redirect_url=%2F#/job/123`); carry it over.
    if (!target.hash && u.hash) target.hash = u.hash;
    return target;
  }
  return undefined;
}

function cleanParsed(u: URL): string {
  const out = new URL(u.toString());
  out.username = '';
  out.password = '';

  // Path segments that look like tokens become a placeholder.
  out.pathname = out.pathname
    .split('/')
    .map((seg) => (looksSecret(fullyDecode(seg)) ? ':token' : seg))
    .join('/');

  const kept = new URLSearchParams();
  for (const [name, value] of u.searchParams) {
    const lower = name.toLowerCase();
    if (SENSITIVE_PARAMS.has(lower) || lower.startsWith('x-amz-')) continue;
    if (REDIRECT_PARAMS.includes(lower)) continue; // reported separately as `destination`
    const decoded = fullyDecode(value);
    if (looksSecret(decoded)) continue;
    kept.set(name, decoded.length > MAX_PARAM_VALUE ? `${decoded.slice(0, MAX_PARAM_VALUE)}…` : decoded);
  }
  out.search = kept.toString();

  let hash = out.hash;
  if (hash) {
    const body = fullyDecode(hash.slice(1));
    if (/(access_token|id_token|token|code)=/i.test(body)) {
      hash = '';
    } else {
      // Long opaque ids inside fragments (`#diff-560df8…`) are noise, not context.
      const shortened = body.replace(/[A-Fa-f0-9]{24,}/g, (m) => `${m.slice(0, 8)}…`);
      hash = shortened.length > MAX_FRAGMENT ? `#${shortened.slice(0, MAX_FRAGMENT)}…` : `#${shortened}`;
    }
  }
  out.hash = '';
  let text = out.toString();
  try {
    text = decodeURI(text);
  } catch {
    // keep the encoded form
  }
  return text + hash;
}

/** Clean a tab URL for sending to Claude. Non-web URLs (chrome://, file://) pass through. */
export function cleanUrl(raw: string): CleanedUrl {
  const u = safeParse(raw);
  if (!u) return { url: raw.slice(0, 200), isLoginWall: false };
  if (!isHttp(u)) return { url: `${u.protocol}//${u.host}${u.pathname}`, isLoginWall: false };

  const target = unwrapRedirect(u);
  const loginLike = LOGIN_PATH_RE.test(u.pathname) || LOGIN_HOST_RE.test(u.hostname);
  if (target && (loginLike || target.origin !== u.origin || u.pathname.includes('/cdn-cgi/access/'))) {
    return { url: cleanParsed(u), destination: cleanParsed(target), isLoginWall: true };
  }
  return { url: cleanParsed(u), isLoginWall: loginLike };
}

/**
 * Key used to spot duplicate tabs. Two tabs are duplicates when they show the
 * same page (ignoring in-page anchors), or are login walls for the same destination.
 */
export function dedupeKey(raw: string): string {
  const u = safeParse(raw);
  if (!u || !isHttp(u)) return raw;
  const target = unwrapRedirect(u);
  const page = target && cleanUrl(raw).isLoginWall ? target : u;
  const key = new URL(page.toString());
  // Keep hash routes (`#/orders`), drop plain anchors (`#section`).
  if (!/^#[!/]/.test(key.hash)) key.hash = '';
  for (const name of [...key.searchParams.keys()]) {
    if (SENSITIVE_PARAMS.has(name.toLowerCase())) key.searchParams.delete(name);
  }
  key.searchParams.sort();
  const prefix = page === u ? '' : 'login→';
  return prefix + key.toString().replace(/\/$/, '');
}

/** Host matching for the privacy blocklist. `*.example.com` matches the domain and its subdomains. */
export function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  const h = host.toLowerCase();
  if (!p) return false;
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return h === base || h.endsWith(`.${base}`);
  }
  return h === p;
}

export function isBlocked(raw: string, blocklist: string[]): boolean {
  const u = safeParse(raw);
  if (!u) return false;
  return blocklist.some((pattern) => hostMatches(u.hostname, pattern));
}
