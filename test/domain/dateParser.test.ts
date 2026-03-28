import { describe, it } from 'node:test';
import assert from 'node:assert';
import { defaultDateRangesJson } from '../../src/lib/dateParser.js';
import { createUser } from '../../src/lib/user.js';

describe('dateParser / defaults', () => {
  it('defaultDateRangesJson is valid JSON with one from/to range', () => {
    const j = defaultDateRangesJson();
    const arr = JSON.parse(j) as Array<{ from: string; to: string }>;
    assert.strictEqual(arr.length, 1);
    assert.match(arr[0].from, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(arr[0].to, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('createUser accepts empty date_ranges string without throwing', () => {
    const user = createUser({
      email: 'a@b.com',
      current_date: null,
      reaction_time: 0,
      date_ranges: '',
    });
    assert.strictEqual(user.dateRanges.length, 0);
  });
});
