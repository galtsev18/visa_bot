/**
 * Policy: Geonix / VFS proxy come from Settings sheet via readSettingsFromSheet merge, not from .env in getConfig().
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { getConfig } from '../../src/lib/config.js';

describe('getConfig and VFS proxy keys', () => {
  const keys = ['GEONIX_API_KEY', 'GEONIX_PROXY_LIST_TYPE', 'VFS_PROXY_COUNTRY', 'VFS_PROXY_URL'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      process.env[k] = 'must-not-appear-in-getConfig';
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('leaves geonix* / vfsProxy* sheet keys undefined even if .env has GEONIX/VFS_*', () => {
    const c = getConfig();
    assert.strictEqual(c.geonixApiKey, undefined);
    assert.strictEqual(c.geonixProxyListType, undefined);
    assert.strictEqual(c.vfsProxyCountry, undefined);
    assert.strictEqual(c.vfsProxyUrl, undefined);
  });
});
