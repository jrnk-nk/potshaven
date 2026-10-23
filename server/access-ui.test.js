import test from 'node:test';
import assert from 'node:assert/strict';
import {canAccessPage, canonicalHash, canonicalPage, navigationFor, roleIsOwner} from '../src/access.ts';

test('manager navigation and direct routes exclude all owner-only areas', () => {
  const navigation = navigationFor('manager');
  assert.deepEqual(navigation.slice(0,5).map(item => item.key), ['overview','schedule','sites','inventory','team']);
  for (const page of ['studio','portfolio','activity']) {
    assert.equal(navigation.some(item => item.key === page), false);
    assert.equal(canAccessPage('manager', page), false);
    assert.equal(canAccessPage('owner', page), true);
  }
  for (const page of ['overview','schedule','sites','places','inventory','team','projects','assistant','settings','sites?site=hotel']) assert.equal(canAccessPage('manager', page), true);
});

test('both roles have one Sites workspace and no financial pages while financial features are disabled', () => {
  assert.deepEqual(navigationFor('owner').slice(0,5).map(item => item.key), ['overview','sites','schedule','team','studio']);
  for (const role of ['owner', 'manager']) {
    assert.equal(navigationFor(role).filter(item => item.key === 'sites').length, 1);
    assert.equal(navigationFor(role).some(item => ['places','projects','business'].includes(item.key)), false);
    assert.equal(canAccessPage(role, 'business'), false);
    assert.equal(canAccessPage(role, 'business?site=hotel'), false);
  }
});

test('site bookmarks and deep links normalize without changing role authorization', () => {
  for (const legacy of ['places', 'projects', 'sites']) {
    assert.equal(canonicalPage(legacy), 'sites');
    assert.equal(canonicalHash(`${legacy}?site=a%26b`), 'sites?site=a%26b');
    assert.equal(canAccessPage('manager', `${legacy}?site=a%26b`), true);
  }
  assert.equal(canonicalHash(''), 'overview');
  assert.equal(canAccessPage('manager', 'studio?site=hotel'), false);
  assert.equal(canAccessPage('manager', 'activity?site=hotel'), false);
});

test('unknown roles and pages have no capabilities', () => {
  assert.equal(roleIsOwner('manager'), false);
  for (const role of [undefined,null,'administrator','Owner']) {
    assert.equal(roleIsOwner(role), false);
    for (const page of ['overview','sites','activity','studio','business','settings']) assert.equal(canAccessPage(role,page), false);
  }
  assert.equal(canAccessPage('owner','unknown'), false);
});
