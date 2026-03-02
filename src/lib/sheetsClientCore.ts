/**
 * Low-level Google Sheets API: get/batchGet/update/append + quota retry and state.
 * Used by lib/sheets.ts for domain-oriented operations (Users, Cache, Logs, Settings).
 */
import { google } from 'googleapis';
import { logger } from './logger';
import { sleep, formatErrorForLog } from './utils';

type SheetsV4 = ReturnType<typeof google.sheets>;

const QUOTA_RETRY_WAIT_SEC = 65;

export interface SheetsCoreState {
  sheets: SheetsV4 | null;
  spreadsheetId: string | null;
  quotaExceededNotified: boolean;
  quotaNotifier: ((event: 'exceeded' | 'resolved') => void) | null;
}

function isQuotaError(err: unknown): boolean {
  const e = err as { message?: string; response?: { status?: number } } | undefined;
  const msg = e?.message ?? '';
  return (
    e?.response?.status === 429 ||
    msg.includes('Quota exceeded') ||
    msg.includes('quota metric')
  );
}

async function withQuotaRetry<T>(s: SheetsCoreState, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    if (s.quotaExceededNotified && s.quotaNotifier) {
      s.quotaNotifier('resolved');
      s.quotaExceededNotified = false;
    }
    return result;
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    if (!s.quotaExceededNotified && s.quotaNotifier) {
      s.quotaNotifier('exceeded');
      s.quotaExceededNotified = true;
    }
    logger.info(`Sheets API quota exceeded. Waiting ${QUOTA_RETRY_WAIT_SEC}s before retry...`);
    await sleep(QUOTA_RETRY_WAIT_SEC);
    const result = await fn();
    if (s.quotaNotifier) {
      s.quotaNotifier('resolved');
      s.quotaExceededNotified = false;
    }
    return result;
  }
}

export interface SheetsClientCore {
  setQuotaNotifier(fn: (event: 'exceeded' | 'resolved') => void): void;
  get(range: string): Promise<(string | number)[][]>;
  batchGet(ranges: string[]): Promise<(string | number)[][][]>;
  update(range: string, values: (string | number)[][], valueInputOption?: 'RAW' | 'USER_ENTERED'): Promise<void>;
  batchUpdate(
    updates: { range: string; values: (string | number)[][] }[],
    valueInputOption?: 'RAW' | 'USER_ENTERED'
  ): Promise<void>;
  append(
    range: string,
    values: (string | number)[][],
    options?: { valueInputOption?: 'RAW' | 'USER_ENTERED'; insertDataOption?: 'INSERT_ROWS' | 'OVERWRITE' }
  ): Promise<{ updatedRange?: string }>;
  getSpreadsheetMetadata(): Promise<{ sheetTitles: string[] }>;
  addSheets(titles: string[]): Promise<void>;
  /** Run an arbitrary operation with quota retry (e.g. for multi-step init). */
  withQuotaRetry<T>(fn: () => Promise<T>): Promise<T>;
}

export async function createSheetsClientCore(
  credentialsPath: string,
  spreadsheetId: string
): Promise<SheetsClientCore> {
  const s: SheetsCoreState = {
    sheets: null,
    spreadsheetId: null,
    quotaExceededNotified: false,
    quotaNotifier: null,
  };
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  s.sheets = google.sheets({ version: 'v4', auth });
  s.spreadsheetId = spreadsheetId;

  return {
    setQuotaNotifier(fn) {
      s.quotaNotifier = fn;
    },
    withQuotaRetry<T>(fn: () => Promise<T>) {
      return withQuotaRetry(s, fn);
    },
    async get(range: string): Promise<(string | number)[][]> {
      if (!s.sheets || !s.spreadsheetId) throw new Error('Sheets core not initialized');
      return withQuotaRetry(s, async () => {
        const response = await s.sheets!.spreadsheets.values.get({
          spreadsheetId: s.spreadsheetId!,
          range,
        });
        return (response.data.values ?? []) as (string | number)[][];
      });
    },
    async batchGet(ranges: string[]): Promise<(string | number)[][][]> {
      if (!s.sheets || !s.spreadsheetId) throw new Error('Sheets core not initialized');
      return withQuotaRetry(s, async () => {
        const batch = await s.sheets!.spreadsheets.values.batchGet({
          spreadsheetId: s.spreadsheetId!,
          ranges,
        });
        const valueRanges = batch.data.valueRanges ?? [];
        return valueRanges.map((vr) => (vr.values ?? []) as (string | number)[][]);
      });
    },
    async update(
      range: string,
      values: (string | number)[][],
      valueInputOption: 'RAW' | 'USER_ENTERED' = 'RAW'
    ): Promise<void> {
      if (!s.sheets || !s.spreadsheetId) throw new Error('Sheets core not initialized');
      return withQuotaRetry(s, async () => {
        await s.sheets!.spreadsheets.values.update({
          spreadsheetId: s.spreadsheetId!,
          range,
          valueInputOption,
          requestBody: { values },
        });
      });
    },
    async batchUpdate(
      updates: { range: string; values: (string | number)[][] }[],
      valueInputOption: 'RAW' | 'USER_ENTERED' = 'RAW'
    ): Promise<void> {
      if (!s.sheets || !s.spreadsheetId) throw new Error('Sheets core not initialized');
      if (updates.length === 0) return;
      return withQuotaRetry(s, async () => {
        await s.sheets!.spreadsheets.values.batchUpdate({
          spreadsheetId: s.spreadsheetId!,
          requestBody: {
            valueInputOption,
            data: updates,
          },
        });
      });
    },
    async append(
      range: string,
      values: (string | number)[][],
      options?: { valueInputOption?: 'RAW' | 'USER_ENTERED'; insertDataOption?: 'INSERT_ROWS' | 'OVERWRITE' }
    ): Promise<{ updatedRange?: string }> {
      if (!s.sheets || !s.spreadsheetId) throw new Error('Sheets core not initialized');
      return withQuotaRetry(s, async () => {
        const res = await s.sheets!.spreadsheets.values.append({
          spreadsheetId: s.spreadsheetId!,
          range,
          valueInputOption: options?.valueInputOption ?? 'RAW',
          insertDataOption: options?.insertDataOption ?? 'INSERT_ROWS',
          requestBody: { values },
        });
        return {
          updatedRange: (res.data as { updates?: { updatedRange?: string } })?.updates?.updatedRange,
        };
      });
    },
    async getSpreadsheetMetadata(): Promise<{ sheetTitles: string[] }> {
      if (!s.sheets || !s.spreadsheetId) throw new Error('Sheets core not initialized');
      return withQuotaRetry(s, async () => {
        const spreadsheet = await s.sheets!.spreadsheets.get({
          spreadsheetId: s.spreadsheetId!,
        });
        const sheetTitles = (spreadsheet.data.sheets ?? [])
          .map((sh) => sh.properties?.title)
          .filter((t): t is string => Boolean(t));
        return { sheetTitles };
      });
    },
    async addSheets(titles: string[]): Promise<void> {
      if (!s.sheets || !s.spreadsheetId) throw new Error('Sheets core not initialized');
      if (titles.length === 0) return;
      return withQuotaRetry(s, async () => {
        await s.sheets!.spreadsheets.batchUpdate({
          spreadsheetId: s.spreadsheetId!,
          requestBody: {
            requests: titles.map((title) => ({
              addSheet: { properties: { title } },
            })),
          },
        });
      });
    },
  };
}
