/**
 * When Google Sheets have no active users, poll until at least one appears.
 * Avoids process.exit(1) so systemd does not restart in a tight loop (Restart=on-failure).
 */
import type { User } from '../ports/User';
import type { UserRepository } from '../ports/UserRepository';
import type { DateCache } from '../ports/DateCache';
import { logger } from '../lib/logger';
import { sleep } from '../lib/utils';

export type SheetsInitialData = Awaited<ReturnType<UserRepository['getInitialData']>>;

export async function pollUntilActiveUsersFromSheets(
  config: { sheetsRefreshInterval?: number },
  repo: Pick<UserRepository, 'getInitialData'>,
  dateCache: DateCache,
  initial: SheetsInitialData
): Promise<SheetsInitialData> {
  let users: User[] = initial.users;
  let cacheEntries = initial.cacheEntries;
  const pollSec = Math.max(1, Math.min(config.sheetsRefreshInterval ?? 400, 120));

  while (users.length === 0) {
    logger.warn(
      `No active users in Google Sheets (US_users / VFS users with active=TRUE). Idling; recheck in ${pollSec}s…`
    );
    await sleep(pollSec);
    const data = await repo.getInitialData();
    users = data.users;
    cacheEntries = data.cacheEntries;
    await dateCache.initialize(
      cacheEntries as Parameters<DateCache['initialize']>[0]
    );
  }

  return { users, cacheEntries };
}
