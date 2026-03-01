import { log } from './utils.js';

/**
 * Solve image captcha via 2Captcha (or compatible) API.
 * API key: options.apiKey, or CAPTCHA_2CAPTCHA_API_KEY in .env.
 *
 * @param {string} imageBase64 - Captcha image as base64 (with or without data URL prefix)
 * @param {{ apiKey?: string }} [options] - Optional; apiKey overrides env
 * @returns {Promise<string>} - Solved captcha text
 */
export async function solveImageCaptcha(imageBase64, options = {}) {
  const apiKey = options.apiKey ?? process.env.CAPTCHA_2CAPTCHA_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Captcha solving requires CAPTCHA_2CAPTCHA_API_KEY. ' +
        'Get a key at https://2captcha.com and add it to .env, or use manual captcha (see docs).'
    );
  }

  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const response = await fetch('https://2captcha.com/in.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      key: apiKey,
      method: 'base64',
      body: base64Data,
      json: '1',
    }),
  });
  const data = await response.json();
  if (data.status !== 1 || !data.request) {
    throw new Error(data['request'] || data['error_text'] || '2Captcha submit failed');
  }

  const taskId = data.request;
  const maxAttempts = 24;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(
      `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`
    );
    const result = await res.json();
    if (result.status === 1) {
      return result.request;
    }
    if (result.request !== 'CAPCHA_NOT_READY') {
      throw new Error(result.request || '2Captcha solve failed');
    }
  }
  throw new Error('Captcha solve timeout');
}

/**
 * Solve reCAPTCHA v2 via 2Captcha.
 *
 * @param {string} siteKey - reCAPTCHA site key from the page
 * @param {string} pageUrl - Full URL of the page with captcha
 * @param {{ apiKey?: string }} [options] - Optional; apiKey overrides env
 * @returns {Promise<string>} - g-recaptcha-response token
 */
export async function solveRecaptchaV2(siteKey, pageUrl, options = {}) {
  const apiKey = options.apiKey ?? process.env.CAPTCHA_2CAPTCHA_API_KEY;
  if (!apiKey) {
    throw new Error(
      'reCAPTCHA solving requires CAPTCHA_2CAPTCHA_API_KEY. ' +
        'Add it to .env or use manual captcha.'
    );
  }

  const response = await fetch('https://2captcha.com/in.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      key: apiKey,
      method: 'userrecaptcha',
      googlekey: siteKey,
      pageurl: pageUrl,
      json: '1',
    }),
  });
  const data = await response.json();
  if (data.status !== 1 || !data.request) {
    throw new Error(data['request'] || data['error_text'] || '2Captcha reCAPTCHA submit failed');
  }

  const taskId = data.request;
  const maxAttempts = 24;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(
      `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`
    );
    const result = await res.json();
    if (result.status === 1) {
      return result.request;
    }
    if (result.request !== 'CAPCHA_NOT_READY') {
      throw new Error(result.request || '2Captcha solve failed');
    }
  }
  throw new Error('reCAPTCHA solve timeout');
}

const API2CAPTCHA_BASE = 'https://api.2captcha.com';

/**
 * Solve Cloudflare Turnstile via 2Captcha (API v2).
 * Use for standalone Turnstile widgets or when the challenge page exposes a sitekey.
 *
 * @param {string} siteKey - Turnstile sitekey (data-sitekey from .cf-turnstile or similar)
 * @param {string} pageUrl - Full URL of the page with the challenge
 * @param {{ apiKey?: string }} [options] - Optional; apiKey overrides env
 * @returns {Promise<string>} - Token to submit as cf-turnstile-response
 */
export async function solveTurnstile(siteKey, pageUrl, options = {}) {
  const apiKey = options.apiKey ?? process.env.CAPTCHA_2CAPTCHA_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Turnstile solving requires CAPTCHA_2CAPTCHA_API_KEY. ' +
        'Add it to .env (see https://2captcha.com).'
    );
  }

  const createRes = await fetch(`${API2CAPTCHA_BASE}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: 'TurnstileTaskProxyless',
        websiteURL: pageUrl,
        websiteKey: siteKey,
      },
    }),
  });
  const createData = await createRes.json();
  if (createData.errorId !== 0 || !createData.taskId) {
    throw new Error(
      createData.errorDescription || createData.errorCode || '2Captcha createTask failed'
    );
  }

  const taskId = createData.taskId;
  const maxAttempts = 24;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const resultRes = await fetch(`${API2CAPTCHA_BASE}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });
    const resultData = await resultRes.json();
    if (resultData.errorId !== 0) {
      throw new Error(
        resultData.errorDescription || resultData.errorCode || '2Captcha getTaskResult failed'
      );
    }
    if (resultData.status === 'ready' && resultData.solution && resultData.solution.token) {
      return resultData.solution.token;
    }
    if (resultData.status !== 'processing') {
      throw new Error(resultData.errorDescription || 'Turnstile solve failed');
    }
  }
  throw new Error('Turnstile solve timeout');
}

/**
 * Solve Cloudflare Challenge page Turnstile via 2Captcha (API v2).
 * Use when the challenge is a full Cloudflare challenge page (intercept action, cData, chlPageData).
 *
 * @param {{ sitekey: string, pageurl: string, data?: string, pagedata?: string, action?: string, userAgent?: string }} params - Intercepted from turnstile.render
 * @param {{ apiKey?: string }} [options] - Optional; apiKey overrides env
 * @returns {Promise<{ token: string, userAgent?: string }>}
 */
export async function solveTurnstileChallengePage(params, options = {}) {
  const apiKey = options.apiKey ?? process.env.CAPTCHA_2CAPTCHA_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Cloudflare Turnstile solving requires CAPTCHA_2CAPTCHA_API_KEY. Add it to .env.'
    );
  }

  const task = {
    type: 'TurnstileTaskProxyless',
    websiteURL: params.pageurl,
    websiteKey: params.sitekey,
  };
  if (params.action) task.action = params.action;
  if (params.data) task.data = params.data;
  if (params.pagedata) task.pagedata = params.pagedata;

  const createRes = await fetch(`${API2CAPTCHA_BASE}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey, task }),
  });
  const createData = await createRes.json();
  if (createData.errorId !== 0 || !createData.taskId) {
    throw new Error(
      createData.errorDescription || createData.errorCode || '2Captcha createTask failed'
    );
  }

  const taskId = createData.taskId;
  const maxAttempts = 24;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const resultRes = await fetch(`${API2CAPTCHA_BASE}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });
    const resultData = await resultRes.json();
    if (resultData.errorId !== 0) {
      throw new Error(
        resultData.errorDescription || resultData.errorCode || '2Captcha getTaskResult failed'
      );
    }
    if (resultData.status === 'ready' && resultData.solution && resultData.solution.token) {
      return {
        token: resultData.solution.token,
        userAgent: resultData.solution.userAgent,
      };
    }
    if (resultData.status !== 'processing') {
      throw new Error(resultData.errorDescription || 'Turnstile solve failed');
    }
  }
  throw new Error('Turnstile solve timeout');
}

/**
 * Optional: manual captcha callback. If you pass this to the VFS client,
 * it will call it with captcha info instead of using 2Captcha.
 * Callback can return solved text/token or throw.
 *
 * @typedef { (params: { type: 'image'|'recaptcha'|'turnstile', imageBase64?: string, siteKey?: string, pageUrl?: string }) => Promise<string> } ManualCaptchaSolver
 */
