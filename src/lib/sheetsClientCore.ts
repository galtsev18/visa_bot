/**
 * Low-level Google Sheets API: get/batchGet/update/append + quota retry and state.
 * Used by lib/sheets.ts for domain-oriented operations (Users, Cache, Logs, Settings).
 * On timeout/network/5xx, write operations are buffered and flushed on the next successful call.
 */
import { google } from 'googleapis';
import { logger } from './logger';
import { sleep, formatErrorForLog, getProgressiveDelaySeconds, isSocketHangupError } from './utils';

type SheetsV4 = ReturnType<typeof google.sheets>;

const QUOTA_RETRY_BASE_SEC = 30;
const QUOTA_RETRY_MAX_SEC = 300;
const QUOTA_RETRY_MAX_ATTEMPTS = 6;
const WRITE_BUFFER_MAX = 500;

/** Сколько подряд успешных вызовов нужны, чтобы сбросить счётчик бэкоффа (чтобы один успех между 429 не обнулял прогресс). */
const QUOTA_RESET_AFTER_CONSECUTIVE_SUCCESS = 2;

export interface SheetsCoreState {
  sheets: SheetsV4 | null;
  spreadsheetId: string | null;
  quotaExceededNotified: boolean;
  quotaNotifier: ((event: 'exceeded' | 'resolved') => void) | null;
  /** Consecutive quota errors; used for progressive backoff */
  quotaRetryAttempt: number;
  /** Подряд успешных вызовов после 429; сброс quotaRetryAttempt только после N подряд */
  quotaConsecutiveSuccesses: number;
  /** Незаписанные операции при таймауте/сети; сбрасываются при следующей успешной записи */
  writeBuffer: PendingWrite[];
}

type PendingWrite =
  | {
      op: 'update';
      range: string;
      values: (string | number)[][];
      valueInputOption: 'RAW' | 'USER_ENTERED';
    }
  | {
      op: 'batchUpdate';
      updates: { range: string; values: (string | number)[][] }[];
      valueInputOption: 'RAW' | 'USER_ENTERED';
    }
  | {
      op: 'append';
      range: string;
      values: (string | number)[][];
      options?: { valueInputOption?: 'RAW' | 'USER_ENTERED'; insertDataOption?: 'INSERT_ROWS' | 'OVERWRITE' };
    };

function isQuotaError(err: unknown): boolean {
  const e = err as { message?: string; response?: { status?: number } } | undefined;
  const msg = e?.message ?? '';
  return (
    e?.response?.status === 429 ||
    msg.includes('Quota exceeded') ||
    msg.includes('quota metric')
  );
}

function isTransientError(err: unknown): boolean {
  const e = err as { response?: { status?: number } } | undefined;
  return (
    isQuotaError(err) ||
    isSocketHangupError(err) ||
    (Number(e?.response?.status) >= 500)
  );
}

async function withQuotaRetry<T>(s: SheetsCoreState, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= QUOTA_RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await fn();
      s.quotaConsecutiveSuccesses++;
      if (
        s.quotaRetryAttempt > 0 &&
        s.quotaConsecutiveSuccesses >= QUOTA_RESET_AFTER_CONSECUTIVE_SUCCESS
      ) {
        s.quotaRetryAttempt = 0;
        s.quotaConsecutiveSuccesses = 0;
        if (s.quotaExceededNotified && s.quotaNotifier) {
          s.quotaNotifier('resolved');
          s.quotaExceededNotified = false;
        }
      }
      return result;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      lastError = error;
      s.quotaConsecutiveSuccesses = 0;
      if (!s.quotaExceededNotified && s.quotaNotifier) {
        s.quotaNotifier('exceeded');
        s.quotaExceededNotified = true;
      }
      if (attempt === QUOTA_RETRY_MAX_ATTEMPTS) {
        logger.error(
          `Sheets API quota exceeded after ${QUOTA_RETRY_MAX_ATTEMPTS} retries. Last error: ${formatErrorForLog(error)}`
        );
        throw error;
      }
      const waitSec = getProgressiveDelaySeconds(
        s.quotaRetryAttempt,
        QUOTA_RETRY_BASE_SEC,
        QUOTA_RETRY_MAX_SEC
      );
      s.quotaRetryAttempt++;
      const isFirstBackoff = s.quotaRetryAttempt === 1;
      const logMsg = `Sheets API quota exceeded. Progressive backoff: waiting ${waitSec}s before retry (attempt ${s.quotaRetryAttempt}/${QUOTA_RETRY_MAX_ATTEMPTS})...`;
      if (isFirstBackoff) logger.info(logMsg);
      else logger.debug(logMsg);
      await sleep(waitSec);
    }
  }
  throw lastError;
}

async function applyPendingWrite(
  s: SheetsCoreState,
  pending: PendingWrite
): Promise<void> {
  if (!s.sheets || !s.spreadsheetId) throw new Error('Sheets core not initialized');
  if (pending.op === 'update') {
    await s.sheets.spreadsheets.values.update({
      spreadsheetId: s.spreadsheetId,
      range: pending.range,
      valueInputOption: pending.valueInputOption,
      requestBody: { values: pending.values },
    });
  } else if (pending.op === 'batchUpdate') {
    await s.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: s.spreadsheetId,
      requestBody: {
        valueInputOption: pending.valueInputOption,
        data: pending.updates,
      },
    });
  } else {
    await s.sheets.spreadsheets.values.append({
      spreadsheetId: s.spreadsheetId,
      range: pending.range,
      valueInputOption: pending.options?.valueInputOption ?? 'RAW',
      insertDataOption: pending.options?.insertDataOption ?? 'INSERT_ROWS',
      requestBody: { values: pending.values },
    });
  }
}

type MergedOp =
  | { type: 'batchUpdate'; valueInputOption: 'RAW' | 'USER_ENTERED'; updates: { range: string; values: (string | number)[][] }[] }
  | { type: 'append'; range: string; values: (string | number)[][]; options?: { valueInputOption?: 'RAW' | 'USER_ENTERED'; insertDataOption?: 'INSERT_ROWS' | 'OVERWRITE' } };

/**
 * Объединяет буфер в пачки: подряд идущие update/batchUpdate — в один batchUpdate,
 * подряд идущие append с одним range — в один append. Возвращает пачки и для каждой — сколько операций из буфера вошло.
 */
function mergeWriteBuffer(buffer: PendingWrite[]): { op: MergedOp; count: number }[] {
  const result: { op: MergedOp; count: number }[] = [];
  let i = 0;
  while (i < buffer.length) {
    const start = i;
    const p = buffer[i];
    if (p.op === 'update' || p.op === 'batchUpdate') {
      const valueInputOption = p.valueInputOption;
      const updates: { range: string; values: (string | number)[][] }[] = [];
      while (i < buffer.length) {
        const q = buffer[i];
        if (q.op === 'update') {
          updates.push({ range: q.range, values: q.values });
          i++;
        } else if (q.op === 'batchUpdate') {
          updates.push(...q.updates);
          i++;
        } else break;
      }
      if (updates.length > 0) result.push({ op: { type: 'batchUpdate', valueInputOption, updates }, count: i - start });
    } else {
      const range = p.range;
      const options = p.options;
      const rows: (string | number)[][] = [];
      while (i < buffer.length) {
        const q = buffer[i];
        if (q.op === 'append' && q.range === range && JSON.stringify(q.options ?? {}) === JSON.stringify(options ?? {})) {
          rows.push(...q.values);
          i++;
        } else if (q.op !== 'append') break;
        else break;
      }
      if (rows.length > 0) result.push({ op: { type: 'append', range, values: rows, options }, count: i - start });
    }
  }
  return result;
}

/** Сбрасывает буфер пачками (один batchUpdate на все update/batchUpdate, один append на один range); при транзиентной ошибке останавливается. */
async function flushWriteBuffer(s: SheetsCoreState): Promise<void> {
  if (s.writeBuffer.length === 0) return;
  const merged = mergeWriteBuffer(s.writeBuffer);
  for (let m = 0; m < merged.length; m++) {
    const { op, count } = merged[m];
    try {
      if (op.type === 'batchUpdate') {
        await withQuotaRetry(s, () => {
          if (!s.sheets || !s.spreadsheetId) throw new Error('Sheets core not initialized');
          return s.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: s.spreadsheetId,
            requestBody: { valueInputOption: op.valueInputOption, data: op.updates },
          });
        });
      } else {
        await withQuotaRetry(s, async () => {
          if (!s.sheets || !s.spreadsheetId) throw new Error('Sheets core not initialized');
          await s.sheets.spreadsheets.values.append({
            spreadsheetId: s.spreadsheetId,
            range: op.range,
            valueInputOption: op.options?.valueInputOption ?? 'RAW',
            insertDataOption: op.options?.insertDataOption ?? 'INSERT_ROWS',
            requestBody: { values: op.values },
          });
        });
      }
      for (let k = 0; k < count; k++) s.writeBuffer.shift();
    } catch (error) {
      if (isTransientError(error)) {
        logger.warn(
          `Sheets write buffer flush paused (${s.writeBuffer.length} pending). ${formatErrorForLog(error)}`
        );
        return;
      }
      logger.error(`Sheets buffered write failed (dropping batch): ${formatErrorForLog(error)}`);
      for (let k = 0; k < count; k++) s.writeBuffer.shift();
    }
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
    quotaRetryAttempt: 0,
    quotaConsecutiveSuccesses: 0,
    writeBuffer: [],
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
      await flushWriteBuffer(s);
      try {
        await withQuotaRetry(s, () =>
          applyPendingWrite(s, { op: 'update', range, values, valueInputOption })
        );
      } catch (error) {
        if (isTransientError(error)) {
          if (s.writeBuffer.length >= WRITE_BUFFER_MAX) {
            logger.error(`Sheets write buffer full (${WRITE_BUFFER_MAX}); dropping oldest`);
            s.writeBuffer.shift();
          }
          s.writeBuffer.push({ op: 'update', range, values, valueInputOption });
          logger.warn(`Sheets write buffered (timeout/network). ${formatErrorForLog(error)}`);
          return;
        }
        throw error;
      }
    },
    async batchUpdate(
      updates: { range: string; values: (string | number)[][] }[],
      valueInputOption: 'RAW' | 'USER_ENTERED' = 'RAW'
    ): Promise<void> {
      if (!s.sheets || !s.spreadsheetId) throw new Error('Sheets core not initialized');
      if (updates.length === 0) return;
      await flushWriteBuffer(s);
      try {
        await withQuotaRetry(s, () =>
          applyPendingWrite(s, { op: 'batchUpdate', updates, valueInputOption })
        );
      } catch (error) {
        if (isTransientError(error)) {
          if (s.writeBuffer.length >= WRITE_BUFFER_MAX) {
            logger.error(`Sheets write buffer full (${WRITE_BUFFER_MAX}); dropping oldest`);
            s.writeBuffer.shift();
          }
          s.writeBuffer.push({ op: 'batchUpdate', updates, valueInputOption });
          logger.warn(`Sheets write buffered (timeout/network). ${formatErrorForLog(error)}`);
          return;
        }
        throw error;
      }
    },
    async append(
      range: string,
      values: (string | number)[][],
      options?: { valueInputOption?: 'RAW' | 'USER_ENTERED'; insertDataOption?: 'INSERT_ROWS' | 'OVERWRITE' }
    ): Promise<{ updatedRange?: string }> {
      if (!s.sheets || !s.spreadsheetId) throw new Error('Sheets core not initialized');
      await flushWriteBuffer(s);
      try {
        return await withQuotaRetry(s, async () => {
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
      } catch (error) {
        if (isTransientError(error)) {
          if (s.writeBuffer.length >= WRITE_BUFFER_MAX) {
            logger.error(`Sheets write buffer full (${WRITE_BUFFER_MAX}); dropping oldest`);
            s.writeBuffer.shift();
          }
          s.writeBuffer.push({ op: 'append', range, values, options });
          logger.warn(`Sheets write buffered (timeout/network). ${formatErrorForLog(error)}`);
          return {};
        }
        throw error;
      }
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
