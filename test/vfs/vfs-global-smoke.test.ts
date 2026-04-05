/**
 * VFS provider smoke tests (no browser, no Sheets, no AIS).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { VfsGlobalClient } from '../../src/lib/providers/vfsglobal.js';

describe('VfsGlobalClient without browser session', () => {
  it('book() rejects fetch mode until API mapping exists', async () => {
    const c = new VfsGlobalClient({
      locale: 'rus/en/fra',
      email: 'vfs-smoke@test.com',
      password: 'x',
      useBrowser: false,
    });
    await assert.rejects(
      async () => c.book({}, 'sched', 1, '2025-06-15', '09:00'),
      /not yet implemented for fetch mode|Use browser flow/
    );
  });
});
