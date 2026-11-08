// Moved hosts: the MOVED_HOSTS map and the redirect to the same path on the new host.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { movedResponse, parseMovedHosts } from '../src/lib/hosts.ts';

describe('the map', () => {
  test('pairs separated by commas or spaces, lowercased', () => {
    assert.deepEqual([...parseMovedHosts('Old.Example.com=new.example.com, b.example.org=c.example.org')], [['old.example.com', 'new.example.com'], ['b.example.org', 'c.example.org']]);
  });
  test('nothing set: nothing moved', () => { assert.equal(parseMovedHosts(undefined).size, 0); assert.equal(parseMovedHosts('').size, 0); });
  test('broken entries and a host pointing at itself are left out', () => {
    assert.equal(parseMovedHosts('a.example.com=a.example.com, nohost=, =x.example.com, x.example.com=https://y.example.com, localhost=example.com').size, 0);
  });
});

describe('the redirect', () => {
  const moved = parseMovedHosts('old.example.com=new.example.com');
  test('path and query kept, permanent, method kept', () => {
    const r = movedResponse(new URL('https://old.example.com/t/kimi-k2?window=3'), moved);
    assert.equal(r.status, 308);
    assert.equal(r.headers.get('location'), 'https://new.example.com/t/kimi-k2?window=3');
  });
  test('private routes move too', () => assert.equal(movedResponse(new URL('https://old.example.com/admin/'), moved).headers.get('location'), 'https://new.example.com/admin/'));
  test('any other host is served as it is', () => assert.equal(movedResponse(new URL('https://new.example.com/'), moved), null));
});
