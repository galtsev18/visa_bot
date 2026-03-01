import type { VisaProvider } from '../ports/VisaProvider.js';
import { AisProvider } from '../lib/providers/ais.js';
import { VfsGlobalProviderAdapter } from './VfsGlobalProviderAdapter.js';

export type ProviderId = 'ais' | 'vfsglobal';

export interface VisaProviderFactoryOptions {
  captcha2CaptchaApiKey?: string | null;
  captchaSolver?: ((params: unknown) => Promise<string>) | null;
}

/**
 * Returns a VisaProvider for the given provider id.
 * Use this in Bot/BookingService instead of hardcoding VisaHttpClient.
 */
export function createVisaProvider(
  providerId: string,
  options: VisaProviderFactoryOptions = {}
): VisaProvider {
  const id = (providerId || 'ais').toLowerCase();
  if (id === 'vfsglobal') {
    return new VfsGlobalProviderAdapter({
      captchaApiKey: options.captcha2CaptchaApiKey ?? undefined,
      captchaSolver: options.captchaSolver ?? undefined,
    });
  }
  return new AisProvider();
}
