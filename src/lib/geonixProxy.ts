/**
 * Geonix proxy API client (https://geonix.com, https://docs.geonix.com/).
 * Used to fetch proxy list for a given country so VFS cabinet (e.g. Russia-only) is accessible.
 *
 * API: GET https://geonix.com/personal/api/v1/{apiKey}/proxy/list/{type}
 * Response: { status, data: { items: [{ ip, port_http, port_socks, login, password, country, ... }] } }
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

/**
 * Return one proxy for the given country. Uses HTTP port by default.
 * Format: { url: 'http://host:port', username, password } for Puppeteer page.authenticate().
 */
export async function geonixGetProxyForCountry(
  apiKey: string,
  country: string,
  type: GeonixProxyType = 'ipv4'
): Promise<{ server: string; username: string; password: string } | null> {
  const items = await geonixListProxies(apiKey, type);
  const active = items.filter((i) => (i.status || '').toUpperCase() === 'ACTIVE');
  const forCountry = active.filter((i) => countryMatches(i.country, country));
  if (forCountry.length === 0) {
    logger.warn(`Geonix: no active ${type} proxies found for country "${country}" (have ${active.length} total)`);
    return null;
  }
  const one = forCountry[0];
  const port = one.port_http || one.port_socks || 80;
  const server = `${one.ip}:${port}`;
  return {
    server,
    username: one.login || '',
    password: one.password || '',
  };
}

/**
 * Build proxy server string for Puppeteer args (--proxy-server=host:port).
 * Auth is done via page.authenticate(), not in the URL.
 */
export function proxyServerArg(server: string): string {
  const hostPort = server.includes('://') ? server.replace(/^[^:]+:\/\//, '') : server;
  return `--proxy-server=http://${hostPort}`;
}

export interface VfsProxyResolved {
  server: string;
  username: string;
  password: string;
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
      username: u.username || '',
      password: u.password || '',
    };
  } catch {
    return null;
  }
}

/**
 * Resolve VFS proxy from config: use vfsProxyUrl if set, else fetch from Geonix for vfsProxyCountry.
 */
export async function resolveVfsProxy(config: {
  vfsProxyUrl?: string | null;
  geonixApiKey?: string | null;
  vfsProxyCountry?: string | null;
}): Promise<VfsProxyResolved | null> {
  if (config.vfsProxyUrl?.trim()) {
    const parsed = parseProxyUrl(config.vfsProxyUrl.trim());
    if (parsed) return parsed;
  }
  const apiKey = config.geonixApiKey?.trim();
  const country = (config.vfsProxyCountry || 'Russia').trim();
  if (!apiKey) return null;
  return geonixGetProxyForCountry(apiKey, country, 'ipv4');
}
