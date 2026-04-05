/**
 * Headed browser session that logs network (CDP), console, page errors, and periodic DOM probes
 * for all frames — for debugging VFS login / Turnstile without streaming to a remote service.
 *
 * Uses the same VFS proxy as monitor / list-vfs-dates (Settings sheet), unless --no-proxy.
 *
 * Usage: run the command, solve captcha in the window, navigate until done, then Ctrl+C.
 * Output: .tmp/vfs-login-debug/<iso-timestamp>/
 */
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { getConfig, validateEnvForSheets } from '../lib/config';
import { proxyServerArg, resolveVfsProxy } from '../lib/geonixProxy';
import { initializeSheets, readSettingsFromSheet } from '../lib/sheets';
import { logger } from '../lib/logger';

const CREDS_FILE = '.tmp/vfs-login.json';

function safeJsonAppend(file: string, line: object): Promise<void> {
  return appendFile(file, JSON.stringify(line) + '\n', 'utf8');
}

export async function vfsLoginDebugCaptureCommand(options: {
  url?: string;
  /** Seconds between automatic snapshots (default 5) */
  interval?: string;
  /** Max length of HTML dump per main frame (default 80000) */
  htmlMax?: string;
  /** Commander: --no-proxy disables VFS_PROXY_URL / Geonix */
  proxy?: boolean;
}): Promise<void> {
  const intervalSec = Math.max(2, Math.min(120, Number.parseInt(options.interval ?? '5', 10) || 5));
  const htmlMax = Math.max(5000, Math.min(500_000, Number.parseInt(options.htmlMax ?? '80000', 10) || 80000));

  let loginUrl = options.url?.trim();
  if (!loginUrl) {
    try {
      const creds = JSON.parse(await readFile(join(process.cwd(), CREDS_FILE), 'utf8')) as {
        loginUrl?: string;
      };
      loginUrl = creds.loginUrl?.trim();
    } catch {
      /* use error below */
    }
  }
  if (!loginUrl) {
    throw new Error(`Set --url or create ${CREDS_FILE} (run get-vfs-login-credentials) with loginUrl`);
  }

  const envConfig = getConfig();
  validateEnvForSheets(envConfig);
  await initializeSheets(envConfig.googleCredentialsPath!, envConfig.googleSheetsId!);
  const sheetSettings = (await readSettingsFromSheet()) as Record<string, unknown>;
  const config = { ...envConfig, ...sheetSettings } as {
    geonixApiKey?: string | null;
    geonixProxyListType?: string | null;
    vfsProxyCountry?: string | null;
    vfsProxyUrl?: string | null;
  };

  const useProxy = options.proxy !== false;
  const resolvedProxy = useProxy
    ? await resolveVfsProxy({
        vfsProxyUrl: config.vfsProxyUrl ?? null,
        geonixApiKey: config.geonixApiKey ?? null,
        geonixProxyListType: config.geonixProxyListType ?? null,
        vfsProxyCountry: config.vfsProxyCountry ?? null,
      })
    : null;
  if (resolvedProxy) logger.info(`vfs-login-debug: using VFS proxy ${resolvedProxy.server}`);
  if (!useProxy) logger.info('vfs-login-debug: direct connection (--no-proxy)');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(process.cwd(), '.tmp', 'vfs-login-debug', stamp);
  await mkdir(outDir, { recursive: true });

  const launchArgs = ['--window-size=1280,900', '--no-sandbox', '--disable-setuid-sandbox'];
  if (resolvedProxy?.server) {
    launchArgs.push(proxyServerArg(resolvedProxy.server));
  }

  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: launchArgs,
  });

  const page = (await browser.newPage()) as import('puppeteer').Page & {
    authenticate?: (opts: { username: string; password: string }) => Promise<void>;
  };
  if (resolvedProxy?.server) {
    const proxyUser = (resolvedProxy.username ?? '').trim();
    const proxyPass = (resolvedProxy.password ?? '').trim();
    if (proxyUser || proxyPass) {
      if (page.authenticate) {
        await page.authenticate({ username: proxyUser, password: proxyPass });
      } else {
        logger.warn('vfs-login-debug: proxy set but Page.authenticate unavailable');
      }
    } else {
      logger.info(
        'vfs-login-debug: proxy without login/password (e.g. Geonix IP whitelist) — no page.authenticate()'
      );
    }
  }
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  const paths = {
    networkReq: join(outDir, 'network-request.jsonl'),
    networkRes: join(outDir, 'network-response.jsonl'),
    console: join(outDir, 'browser-console.jsonl'),
    pageerror: join(outDir, 'pageerror.jsonl'),
    requestfailed: join(outDir, 'requestfailed.jsonl'),
    frameNav: join(outDir, 'framenavigated.jsonl'),
    readme: join(outDir, 'README.txt'),
  };

  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');

  cdp.on('Network.requestWillBeSent', (e) => {
    void safeJsonAppend(paths.networkReq, {
      t: Date.now(),
      requestId: e.requestId,
      url: e.request.url,
      method: e.request.method,
      type: e.type,
      headers: e.request.headers,
    });
  });

  cdp.on('Network.responseReceived', (e) => {
    void safeJsonAppend(paths.networkRes, {
      t: Date.now(),
      requestId: e.requestId,
      url: e.response.url,
      status: e.response.status,
      mimeType: e.response.mimeType,
      headers: e.response.headers,
    });
  });

  page.on('console', (msg) => {
    void safeJsonAppend(paths.console, {
      t: Date.now(),
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
    });
  });

  page.on('pageerror', (err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    void safeJsonAppend(paths.pageerror, {
      t: Date.now(),
      message: e.message,
      stack: e.stack,
    });
  });

  page.on('requestfailed', (req) => {
    void safeJsonAppend(paths.requestfailed, {
      t: Date.now(),
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText,
    });
  });

  page.on('framenavigated', (frame) => {
    void safeJsonAppend(paths.frameNav, {
      t: Date.now(),
      frameUrl: frame.url(),
      isMain: frame === page.mainFrame(),
    });
  });

  let snap = 0;
  const snapshot = async (reason: string) => {
    snap += 1;
    const framesPayload: unknown[] = [];
    for (const frame of page.frames()) {
      try {
        const data = await frame.evaluate((maxHtml: number) => {
          const scripts = Array.from(document.scripts).map((s) => ({
            src: s.src || null,
            inlineChars: s.src ? 0 : (s.textContent?.length ?? 0),
          }));
          const cfTurnstile = document.querySelector(
            'textarea[name="cf-turnstile-response"], input[name="cf-turnstile-response"]'
          ) as HTMLInputElement | null;
          return {
            href: location.href,
            title: document.title,
            scriptCount: scripts.length,
            scriptsPreview: scripts.slice(0, 50),
            iframeCount: document.querySelectorAll('iframe').length,
            cfChallengeIframes: document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length,
            cfTurnstileFieldLen: cfTurnstile?.value?.length ?? 0,
            inputs: Array.from(document.querySelectorAll('input')).map((i) => ({
              type: i.type,
              name: i.name,
              id: i.id,
              className: i.className?.slice?.(0, 80),
            })),
            bodyPreview: (document.body?.innerText ?? '').slice(0, 2500),
            htmlHead: document.documentElement.outerHTML.slice(0, maxHtml),
          };
        }, htmlMax);
        framesPayload.push({ frameUrl: frame.url(), ok: true, data });
      } catch (e) {
        framesPayload.push({ frameUrl: frame.url(), ok: false, error: String(e) });
      }
    }
    const name = `snapshot-${String(snap).padStart(3, '0')}-${reason}.json`;
    await writeFile(join(outDir, name), JSON.stringify({ t: Date.now(), reason, frames: framesPayload }, null, 2), 'utf8');
    logger.info(`VFS debug: wrote ${name}`);
  };

  logger.info(`VFS login debug: writing to ${outDir}`);
  logger.info(`Opening ${loginUrl}`);

  await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 180_000 });
  await snapshot('after-goto');

  const timer = setInterval(() => {
    void snapshot(`interval-${intervalSec}s`);
  }, intervalSec * 1000);

  const shutdown = async () => {
    clearInterval(timer);
    await snapshot('before-close');
    try {
      await page.screenshot({ path: join(outDir, 'screenshot-full.png'), fullPage: true });
    } catch {
      /* */
    }
    await writeFile(
      paths.readme,
      [
        'VFS login debug capture',
        `loginUrl: ${loginUrl}`,
        `proxy: ${resolvedProxy ? resolvedProxy.server : 'none (direct or --no-proxy)'}`,
        '',
        'Files:',
        '- network-request.jsonl / network-response.jsonl — CDP Network (can be large)',
        '- browser-console.jsonl — page console',
        '- pageerror.jsonl — uncaught errors in page',
        '- requestfailed.jsonl — failed requests',
        '- framenavigated.jsonl — frame navigations',
        '- snapshot-*.json — per-frame DOM probe + truncated HTML',
        '- screenshot-full.png — final full-page screenshot',
        '',
        'Zip this folder and attach to a chat, or point the assistant at .tmp/vfs-login-debug/<this folder>.',
        '',
        'Note: HTML is truncated per frame (see --html-max). No secrets are redacted — do not share publicly.',
      ].join('\n'),
      'utf8'
    );
    await browser.close();
    logger.info(`VFS login debug: done. Output: ${outDir}`);
  };

  process.once('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });

  logger.info(`VFS login debug: solve captcha / log in in the browser window. Press Ctrl+C when finished to save snapshots and exit.`);
}
