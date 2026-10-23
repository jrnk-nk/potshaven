import test from 'node:test';
import assert from 'node:assert/strict';
import {canAccessPage, navigationFor, roleIsOwner} from '../src/access.ts';

test('manager navigation and direct routes exclude all owner-only areas', () => {
  const navigation = navigationFor('manager');
  assert.deepEqual(navigation.slice(0,5).map(item => item.key), ['overview','schedule','places','inventory','team']);
  for (const page of ['studio','portfolio','business']) {
    assert.equal(navigation.some(item => item.key === page), false);
    assert.equal(canAccessPage('manager', page), false);
    assert.equal(canAccessPage('owner', page), true);
  }
  for (const page of ['overview','schedule','places','inventory','team','projects','assistant','settings']) assert.equal(canAccessPage('manager', page), true);
});

test('owner navigation emphasizes business control and unknown roles have no capabilities', () => {
  assert.deepEqual(navigationFor('owner').slice(0,5).map(item => item.key), ['overview','projects','business','team','studio']);
  assert.equal(roleIsOwner('manager'), false);
  for (const role of [undefined,null,'administrator','Owner']) {
    assert.equal(roleIsOwner(role), false);
    for (const page of ['overview','studio','business','settings']) assert.equal(canAccessPage(role,page), false);
  }
  assert.equal(canAccessPage('owner','unknown'), false);
});
