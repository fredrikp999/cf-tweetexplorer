import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryFor } from '../src/history/query.ts';

const none = { excludeReplies: false, excludeRetweets: false, minFaves: 0, lang: '' };

test('no filters: only the query and the window', () => {
  assert.equal(queryFor('sandbox', none, 10, 20), 'sandbox since_time:10 until_time:20');
});

test('excluded retweets are asked for in the query, so they are not paid for', () => {
  assert.equal(queryFor('sandbox', { ...none, excludeRetweets: true }, 10, 20), 'sandbox since_time:10 until_time:20 -filter:retweets');
});

test('every filter goes in the query', () => {
  assert.equal(queryFor('sandbox', { excludeReplies: true, excludeRetweets: true, minFaves: 5, lang: 'sv' }, 10, 20),
    'sandbox since_time:10 until_time:20 -filter:replies -filter:retweets min_faves:5 lang:sv');
});
