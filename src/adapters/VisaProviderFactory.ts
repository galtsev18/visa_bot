import type { VisaProvider } from '../ports/VisaProvider';
import { AisProvider } from '../lib/providers/ais';
import { VfsGlobalProviderAdapter } from './VfsGlobalProviderAdapter';

export type ProviderId = 'ais' | 'vfsglobal';

export interface VisaProviderFactoryOptions {
  captcha2CaptchaApiKey?: string | null;
  captchaSolver?: ((params: unknown) => Promise<string>) | null;
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
  const id = (providerId || 'ais').toLowerCase();
  if (id === 'vfsglobal') {
    return new VfsGlobalProviderAdapter({
      captchaApiKey: options.captcha2CaptchaApiKey ?? undefined,
      captchaSolver: options.captchaSolver ?? undefined,
    });
  }
  if (id === 'ais') {
    return new AisProvider();
  }
  throw new Error(`Unknown visa provider: ${providerId}. Supported: ais, vfsglobal.`);
}
