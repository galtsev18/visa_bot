import type { VisaProvider } from '../ports/VisaProvider';
import { AisProvider } from '../lib/providers/ais';
import { VfsGlobalProviderAdapter } from './VfsGlobalProviderAdapter';
import type { VfsProxyResolved } from '../lib/geonixProxy';

export type ProviderId = 'ais' | 'vfsglobal';

export interface VisaProviderFactoryOptions {
  captcha2CaptchaApiKey?: string | null;
  captchaSolver?: ((params: unknown) => Promise<string>) | null;
  /** Resolved proxy for VFS (e.g. from Geonix for Russian IP). */
  vfsProxy?: VfsProxyResolved | null;
}

/**
 * Returns a VisaProvider for the given provider id.
 * Use this in Bot/BookingService instead of hardcoding VisaHttpClient.
 * @throws Error if providerId is not supported
 */
export function createVisaProvider(
  providerId: string,
  options: VisaProviderFactoryOptions = {}
): VisaProvider {
  const id = (providerId || 'ais').toLowerCase().replace(/^vfs$/, 'vfsglobal');
  if (id === 'vfsglobal') {
    return new VfsGlobalProviderAdapter({
      captchaApiKey: options.captcha2CaptchaApiKey ?? undefined,
      captchaSolver: options.captchaSolver ?? undefined,
      proxy: options.vfsProxy ?? undefined,
    });
  }
  if (id === 'ais') {
    return new AisProvider();
  }
  throw new Error(`Unknown visa provider: ${providerId}. Supported: ais, vfsglobal.`);
}
