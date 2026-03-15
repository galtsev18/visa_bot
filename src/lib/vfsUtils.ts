/**
 * VFS Global helpers: derive locale/path from login or cabinet URL.
 * Used so the browser opens the correct country-specific login page.
 */
export function localeFromLoginUrl(loginUrl: string): string {
  if (!loginUrl || typeof loginUrl !== 'string') return 'rus/en/fra';
  try {
    const path = new URL(loginUrl.trim()).pathname
      .replace(/\/dashboard\/?$/i, '')
      .replace(/\/login\/?$/i, '')
      .replace(/^\/+|\/+$/g, '');
    return path || 'rus/en/fra';
  } catch {
    return 'rus/en/fra';
  }
}
