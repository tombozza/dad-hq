// The shared events engine's hand-edit check (src/events.js is byte-for-byte the same in Bozza HQ).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEventEdit } from '../src/events.js';

const row = { title: 'Fair', start_date: '2026-12-05', end_date: '2026-12-06' };

test('an edit keeps only the fields sent, tidied', () => {
  const { cols } = cleanEventEdit({ price: '  Free ', url: 'example.com', distanceMiles: '12.4', kidFriendly: true, category: 'nope', region: 'mars' }, row);
  assert.deepEqual(cols, { price: 'Free', url: 'https://example.com', distance_miles: 12, kid_friendly: 1, category: 'other', region: 'uk' });
});

test('dates: a bad one is refused, an end before the start becomes the start', () => {
  assert.ok(cleanEventEdit({ startDate: '5/12/2026' }, row).error);
  assert.equal(cleanEventEdit({ startDate: '2026-12-10' }, row).cols.end_date, '2026-12-10');
  assert.equal(cleanEventEdit({ endDate: '' }, row).cols.end_date, '2026-12-05');
  assert.equal(cleanEventEdit({ endDate: '2026-12-07' }, row).cols.end_date, '2026-12-07');
});

test('a new event needs a name and a start date', () => {
  assert.ok(cleanEventEdit({ title: ' ', startDate: '2026-12-05' }, null).error);
  assert.ok(cleanEventEdit({ title: 'X', startDate: '' }, null).error);
  const { cols } = cleanEventEdit({ title: 'X', startDate: '2026-12-05' }, null);
  assert.equal(cols.end_date, '2026-12-05');
});
