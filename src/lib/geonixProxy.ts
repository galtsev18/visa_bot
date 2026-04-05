/**
 * Geonix proxy API client (https://geonix.com, https://docs.geonix.com/).
 * Used to fetch proxy list for a given country so VFS cabinet (e.g. Russia-only) is accessible.
 *
 * API: GET https://geonix.com/personal/api/v1/{apiKey}/proxy/list/{type}
 * Docs: https://docs.geonix.com/api-reference/proxies/list-proxies
 * Each item has `port_http` (HTTP proxy) and `port_socks` (SOCKS) — different ports; do not mix.
 *
 * Rate limit: max 60 requests per minute (enforced strictly).
 */

import { logger } from './logger';

const GEONIX_API_BASE = 'https://geonix.com/personal/api/v1';
const GEONIX_MAX_REQUESTS_PER_MINUTE = 60;
const GEONIX_WINDOW_MS = 60_000;

/** Timestamps of requests in the last minute (oldest first). */
const requestTimestamps: number[] = [];
let rateLimitQueue: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wait until we are under the limit (60 requests per minute), then record this request.
 * Serializes all Geonix API calls so the limit is never exceeded.
 */
async function geonixRateLimitAcquire(): Promise<void> {
  const prev = rateLimitQueue;
  let resolve: () => void;
  rateLimitQueue = new Promise((r) => {
    resolve = r;
  });
  await prev;

  const now = Date.now();
  const cutoff = now - GEONIX_WINDOW_MS;
  while (requestTimestamps.length > 0 && requestTimestamps[0]! < cutoff) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= GEONIX_MAX_REQUESTS_PER_MINUTE) {
    const waitMs = requestTimestamps[0]! + GEONIX_WINDOW_MS - now;
    if (waitMs > 0) {
      logger.debug(`Geonix API: rate limit, waiting ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);
      requestTimestamps.shift();
    }
  }
  requestTimestamps.push(Date.now());
  resolve!();
}

export type GeonixProxyType = 'ipv4' | 'ipv6' | 'mobile' | 'isp' | 'resident';

export interface GeonixProxyItem {
  id: number;
  order_id: number;
  ip: string;
  port_http: number;
  port_socks: number;
  login: string;
  password: string;
  auth_ip?: string;
  country: string;
  date_start?: string;
  date_end?: string;
  comment?: string;
  status: string;
  rotation?: string;
  link_reboot?: string;
  can_prolong?: boolean;
}

export interface GeonixListResponse {
  status: string;
  data: { items?: GeonixProxyItem[]; ipv4?: GeonixProxyItem[]; ipv6?: GeonixProxyItem[]; mobile?: GeonixProxyItem[] };
  errors: string[];
}

/**
 * Fetch proxy list from Geonix API for the given type.
 * See https://docs.geonix.com/api-reference/proxies/list-proxies
 * Respects rate limit: max 60 requests per minute.
 */
export async function geonixListProxies(
  apiKey: string,
  type: GeonixProxyType = 'ipv4'
): Promise<GeonixProxyItem[]> {
  await geonixRateLimitAcquire();
  const url = `${GEONIX_API_BASE}/${encodeURIComponent(apiKey)}/proxy/list/${type}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Geonix API error: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as GeonixListResponse;
  if (json.status !== 'success') {
    throw new Error(`Geonix API returned status: ${json.status}, errors: ${JSON.stringify(json.errors)}`);
  }
  const items = json.data?.items ?? json.data?.ipv4 ?? json.data?.ipv6 ?? json.data?.mobile ?? [];
  return Array.isArray(items) ? items : [];
}

/**
 * Normalize country name for filtering (API may return "USA", "Russia", "Russian Federation", etc.).
 */
function countryMatches(itemCountry: string, wanted: string): boolean {
  const a = (itemCountry || '').toLowerCase().trim();
  const b = (wanted || '').toLowerCase().trim();
  if (a === b) return true;
  const aliases: Record<string, string[]> = {
    russia: ['russia', 'russian federation', 'ru', 'россия'],
    usa: ['usa', 'united states', 'us', 'america'],
  };
  const wantKey = b in aliases ? b : b.split(/\s+/)[0];
  const list = aliases[wantKey];
  if (list) return list.some((alias) => a.includes(alias) || alias.includes(a));
  return a.includes(b) || b.includes(a);
}

/** Login/password from API item (docs: login, password). */
export function geonixCredentialsFromItem(one: GeonixProxyItem): { username: string; password: string } {
  const raw = one as unknown as Record<string, unknown>;
  const login = String(raw.login ?? raw.user ?? raw.username ?? '').trim();
  const password = String(raw.password ?? raw.pass ?? '').trim();
  return { username: login, password };
}

/**
 * Host for `--proxy-server`. Geonix sets `ip` to the proxy socket clients must use.
 * `auth_ip` is often metadata (whitelist/binding); using it as host caused ERR_PROXY_CONNECTION_FAILED in the wild.
 * Fallback to `auth_ip` only when `ip` is empty.
 */
export function geonixConnectionHost(one: GeonixProxyItem): string {
  const main = String(one.ip ?? '').trim();
  const auth = String(one.auth_ip ?? '').trim();
  return main || auth;
}

/**
 * Geonix returns separate HTTP and SOCKS ports — Chromium must use the matching scheme.
 * @see https://docs.geonix.com/api-reference/proxies/list-proxies (port_http vs port_socks)
 */
export function geonixServerFromItem(one: GeonixProxyItem): { server: string; kind: 'http' | 'socks5' } {
  const host = geonixConnectionHost(one);
  const httpPort = Number(one.port_http) || 0;
  const socksPort = Number(one.port_socks) || 0;
  if (httpPort > 0) {
    return { server: `${host}:${httpPort}`, kind: 'http' };
  }
  if (socksPort > 0) {
    return { server: `socks5://${host}:${socksPort}`, kind: 'socks5' };
  }
  return { server: `${host}:80`, kind: 'http' };
}

const VALID_GEONIX_TYPES: GeonixProxyType[] = ['ipv4', 'ipv6', 'mobile', 'isp', 'resident'];

/** Settings key GEONIX_PROXY_LIST_TYPE (e.g. ipv4, mobile). Invalid values fall back to ipv4. */
export function normalizeGeonixListType(raw: string | null | undefined): GeonixProxyType {
  const s = (raw || 'ipv4').trim().toLowerCase();
  return VALID_GEONIX_TYPES.includes(s as GeonixProxyType) ? (s as GeonixProxyType) : 'ipv4';
}

export interface VfsProxyResolved {
  server: string;
  username: string;
  password: string;
  /** Geonix `auth_ip` from list API (provider metadata; not necessarily the IP to whitelist). */
  authIpHint?: string;
}

/**
 * Return one proxy for the given country from Geonix list API.
 * Prefers ACTIVE rows with matching country and non-empty login+password when possible.
 */
export async function geonixGetProxyForCountry(
  apiKey: string,
  country: string,
  type: GeonixProxyType = 'ipv4'
): Promise<VfsProxyResolved | null> {
  const items = await geonixListProxies(apiKey, type);
  const active = items.filter((i) => (i.status || '').toUpperCase() === 'ACTIVE');
  const forCountry = active.filter((i) => countryMatches(i.country, country));
  if (forCountry.length === 0) {
    logger.warn(`Geonix: no active ${type} proxies found for country "${country}" (have ${active.length} total active)`);
    return null;
  }

  const withBothCreds = forCountry.filter((i) => {
    const { username, password } = geonixCredentialsFromItem(i);
    return username.length > 0 && password.length > 0;
  });
  const pool = withBothCreds.length > 0 ? withBothCreds : forCountry;
  if (withBothCreds.length === 0) {
    logger.info(
      'Geonix: no login+password in API for this country — normal for IP-whitelist proxies; browser connects without Proxy-Authorization'
    );
  }

  const one = pool[0];
  const { username, password } = geonixCredentialsFromItem(one);
  const { server, kind } = geonixServerFromItem(one);
  const rawIp = String(one.ip ?? '').trim();
  const authIp = String(one.auth_ip ?? '').trim();
  logger.info(
    `Geonix proxy: ${kind.toUpperCase()} ${server} (country match, login: ${username ? 'yes' : 'no'}, password: ${password ? 'yes' : 'no'})`
  );
  if (authIp && rawIp && authIp !== rawIp) {
    logger.info(
      `Geonix: proxy endpoint ${server} uses field "ip" (${rawIp}); "auth_ip" (${authIp}) is order metadata — whitelist your egress IP in Geonix`
    );
  }

  if (!username && !password) {
    await logPublicEgressIpForGeonixWhitelist();
  } else if (one.auth_ip) {
    logger.debug(`Geonix item auth_ip: ${one.auth_ip}`);
  }

  return {
    server,
    username,
    password,
    authIpHint: one.auth_ip ? String(one.auth_ip).trim() : undefined,
  };
}

/** Resolves current public IP (for Geonix whitelist checks). Fire-and-forget safe. */
export async function logPublicEgressIpForGeonixWhitelist(): Promise<void> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const r = await fetch('https://api.ipify.org?format=json', { signal: ac.signal });
    clearTimeout(timer);
    if (!r.ok) return;
    const j = (await r.json()) as { ip?: string };
    if (j.ip) {
      logger.info(
        `Geonix whitelist: add THIS public egress IP in your Geonix panel: ${j.ip} (not the API "auth_ip" field). Wait a few minutes after saving`
      );
    }
  } catch {
    /* ignore — no network or timeout */
  }
}

/**
 * Build proxy server string for Puppeteer args (--proxy-server=...).
 * Supports plain host:port (HTTP), http(s)://..., socks5://...
 */
export function proxyServerArg(server: string): string {
  const t = server.trim();
  if (/^(socks5?:\/\/|https?:\/\/)/i.test(t)) {
    return `--proxy-server=${t}`;
  }
  const hostPort = t.includes('://') ? t.replace(/^[^:]+:\/\//, '') : t;
  return `--proxy-server=http://${hostPort}`;
}

/**
 * Parse proxy URL (http://user:pass@host:port or http://host:port) into { server, username, password }.
 */
export function parseProxyUrl(url: string): VfsProxyResolved | null {
  const s = (url || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    const server = `${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
    return {
      server,
      username: (u.username || '').trim(),
      password: (u.password || '').trim(),
      authIpHint: undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve VFS proxy: optional VFS_PROXY_URL overrides Geonix.
 * Without URL: GEONIX_API_KEY + VFS_PROXY_COUNTRY + optional GEONIX_PROXY_LIST_TYPE (ipv4|ipv6|mobile|isp|resident).
 */
export async function resolveVfsProxy(config: {
  vfsProxyUrl?: string | null;
  geonixApiKey?: string | null;
  vfsProxyCountry?: string | null;
  /** From Settings GEONIX_PROXY_LIST_TYPE — which Geonix list endpoint (default ipv4). */
  geonixProxyListType?: string | null;
}): Promise<VfsProxyResolved | null> {
  if (config.vfsProxyUrl?.trim()) {
    const parsed = parseProxyUrl(config.vfsProxyUrl.trim());
    if (parsed) return parsed;
  }
  const apiKey = config.geonixApiKey?.trim();
  const country = (config.vfsProxyCountry || 'Russia').trim();
  if (!apiKey) return null;
  const listType = normalizeGeonixListType(config.geonixProxyListType ?? undefined);
  return geonixGetProxyForCountry(apiKey, country, listType);
}
