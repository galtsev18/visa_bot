/**
 * Solve image captcha via 2Captcha (or compatible) API.
 * API key: options.apiKey, or CAPTCHA_2CAPTCHA_API_KEY in .env.
 */

export interface CaptchaOptions {
  apiKey?: string;
}

export interface TurnstileChallengeParams {
  sitekey: string;
  pageurl: string;
  data?: string;
  pagedata?: string;
  action?: string;
  userAgent?: string;
}

export type ManualCaptchaSolver = (params: {
  type: 'image' | 'recaptcha' | 'turnstile';
  imageBase64?: string;
  siteKey?: string;
  pageUrl?: string;
}) => Promise<string>;

export async function solveImageCaptcha(
  imageBase64: string,
  options: CaptchaOptions = {}
): Promise<string> {
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
  const data = (await response.json()) as { status?: number; request?: string; error_text?: string };
  if (data.status !== 1 || !data.request) {
    throw new Error(
      (data as { request?: string }).request ??
        data.error_text ??
        '2Captcha submit failed'
    );
  }

  const taskId = data.request;
  const maxAttempts = 24;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(
      `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`
    );
    const result = (await res.json()) as { status?: number; request?: string };
    if (result.status === 1) {
      return result.request!;
    }
    if (result.request !== 'CAPCHA_NOT_READY') {
      throw new Error(result.request ?? '2Captcha solve failed');
    }
  }
  throw new Error('Captcha solve timeout');
}

export async function solveRecaptchaV2(
  siteKey: string,
  pageUrl: string,
  options: CaptchaOptions = {}
): Promise<string> {
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
  const data = (await response.json()) as { status?: number; request?: string; error_text?: string };
  if (data.status !== 1 || !data.request) {
    throw new Error(
      (data as { request?: string }).request ??
        data.error_text ??
        '2Captcha reCAPTCHA submit failed'
    );
  }

  const taskId = data.request;
  const maxAttempts = 24;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(
      `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`
    );
    const result = (await res.json()) as { status?: number; request?: string };
    if (result.status === 1) {
      return result.request!;
    }
    if (result.request !== 'CAPCHA_NOT_READY') {
      throw new Error(result.request ?? '2Captcha solve failed');
    }
  }
  throw new Error('reCAPTCHA solve timeout');
}

const API2CAPTCHA_BASE = 'https://api.2captcha.com';

export async function solveTurnstile(
  siteKey: string,
  pageUrl: string,
  options: CaptchaOptions = {}
): Promise<string> {
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
  const createData = (await createRes.json()) as {
    errorId?: number;
    taskId?: string;
    errorDescription?: string;
    errorCode?: string;
  };
  if (createData.errorId !== 0 || !createData.taskId) {
    throw new Error(
      createData.errorDescription ??
        createData.errorCode ??
        '2Captcha createTask failed'
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
    const resultData = (await resultRes.json()) as {
      errorId?: number;
      status?: string;
      solution?: { token?: string };
      errorDescription?: string;
      errorCode?: string;
    };
    if (resultData.errorId !== 0) {
      throw new Error(
        resultData.errorDescription ??
          resultData.errorCode ??
          '2Captcha getTaskResult failed'
      );
    }
    if (
      resultData.status === 'ready' &&
      resultData.solution &&
      resultData.solution.token
    ) {
      return resultData.solution.token;
    }
    if (resultData.status !== 'processing') {
      throw new Error(resultData.errorDescription ?? 'Turnstile solve failed');
    }
  }
  throw new Error('Turnstile solve timeout');
}

export async function solveTurnstileChallengePage(
  params: TurnstileChallengeParams,
  options: CaptchaOptions = {}
): Promise<{ token: string; userAgent?: string }> {
  const apiKey = options.apiKey ?? process.env.CAPTCHA_2CAPTCHA_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Cloudflare Turnstile solving requires CAPTCHA_2CAPTCHA_API_KEY. Add it to .env.'
    );
  }

  const task: Record<string, unknown> = {
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
  const createData = (await createRes.json()) as {
    errorId?: number;
    taskId?: string;
    errorDescription?: string;
    errorCode?: string;
  };
  if (createData.errorId !== 0 || !createData.taskId) {
    throw new Error(
      createData.errorDescription ??
        createData.errorCode ??
        '2Captcha createTask failed'
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
    const resultData = (await resultRes.json()) as {
      errorId?: number;
      status?: string;
      solution?: { token?: string; userAgent?: string };
      errorDescription?: string;
      errorCode?: string;
    };
    if (resultData.errorId !== 0) {
      throw new Error(
        resultData.errorDescription ??
          resultData.errorCode ??
          '2Captcha getTaskResult failed'
      );
    }
    if (
      resultData.status === 'ready' &&
      resultData.solution &&
      resultData.solution.token
    ) {
      return {
        token: resultData.solution.token,
        userAgent: resultData.solution.userAgent,
      };
    }
    if (resultData.status !== 'processing') {
      throw new Error(resultData.errorDescription ?? 'Turnstile solve failed');
    }
  }
  throw new Error('Turnstile solve timeout');
}
