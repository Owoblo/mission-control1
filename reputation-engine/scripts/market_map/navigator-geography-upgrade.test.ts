import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locations, listingAreas, queue } from '../src/geography';
import { categories } from '../src/model';
import { Store } from '../src/store';

test('legacy locality captures, cursors and checkpoints survive reopen with GTA available', async () => {
  // Geography is code configuration, not an IndexedDB store. Seed the same version-1
  // records an old installation would have, then reopen with the expanded catalog.
  const name = `geography-upgrade-${crypto.randomUUID()}`;
  let store = await Store.open(name);
  const original = await store.select(categories[0].id, 'ALL');
  assert.equal(original.locationId, 'loc_windsor_on');
  const saved = await store.save(original, 'legacy Windsor capture\r\n');
  const next = await store.move(original, 1);
  await store.saveDraft(next, 'legacy next-city draft');
  const checkpoint = { id: 'geography-upgrade-legacy-checkpoint', locationId: original.locationId, categoryId: original.categoryId, page: 4 };
  await store.put('settings', checkpoint);
  const before = await store.exportAll();
  const selected = await store.selection();
  store.db.close();
  store = await Store.open(name);
  assert.equal(store.db.version, 1);
  assert.deepEqual(await store.selection(), selected);
  assert.deepEqual(await store.context(original.categoryId, 'ALL'), next);
  assert.deepEqual(await store.get('settings', checkpoint.id), checkpoint);
  assert.equal(await store.draft(next), 'legacy next-city draft');
  const after = await store.exportAll();
  assert.deepEqual(after.captures, before.captures);
  assert.deepEqual(after.progress, before.progress);
  assert.equal(after.captures[0].id, saved.id);
  assert.equal(after.captures[0].rawText, 'legacy Windsor capture\r\n');
  assert.equal(locations.length, 241);
  assert.equal(queue('GTA_HAMILTON').length, 29);
  assert.equal(listingAreas.length, 4);
  for (const label of ['Toronto', 'Scarborough', 'Etobicoke', 'North York']) {
    assert.ok(queue('GTA_HAMILTON').some(item => item.name === label));
  }
  const gta = await store.select(original.categoryId, 'GTA_HAMILTON');
  assert.equal(gta.locationId, 'loc_brampton_on');
  await store.save(gta, 'new Brampton capture');
  assert.equal((await store.exportAll()).captures.length, 2);
  assert.equal((await store.exportAll({regionId:'GTA_HAMILTON'})).captures[0].rawText, 'new Brampton capture');
  store.db.close();
});
