import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Execute the component's actual handlers with React-style snapshot state:
// setters intentionally do not mutate the values captured by this render.
function harness(fetch: () => Promise<unknown>) {
  const source = readFileSync('app/components/sales/lead-detail/estimate-draft-modal.tsx', 'utf8')
  const handlers = source.slice(source.indexOf('  function cancelQuickLookup('), source.indexOf('  function addConjointPresetItem('))
  const items: Array<{ cubicFeet: number; weightLbs: number }> = []
  let error: string | null = null
  let volume = ""
  const context = vm.createContext({
    fetch, quickItem: 'Bookshelf', quickCuFt: '', quickWeightLbs: '', quickQty: '1', quickRoom: 'Living Room',
    quickAddInFlight: { current: false }, quickLookupVersion: { current: 0 }, quickLookupRequest: { current: null }, AbortController,
    setQuickLookupLoading() {}, setQuickLookupNote() {}, setQuickCuFt(value: string) { volume = value }, setQuickWeightLbs() {},
    setQuickItem() {}, setQuickQty() {},
    setQuickLookupError(value: string | null) { error = value },
    onAddInventoryItems(values: typeof items) { items.push(...values) },
  })
  vm.runInContext(ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context)
  return { add: () => vm.runInContext('addQuickItem()', context) as Promise<void>, items, error: () => error, volume: () => volume, lookup: () => vm.runInContext('lookupItemDimensions(quickItem)', context) as Promise<unknown>, cancel: () => vm.runInContext('cancelQuickLookup()', context), setVolume: (value: string) => { context.quickCuFt = value } }
}

test('quick add uses fetched dimensions without waiting for a React rerender', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ cubicFeet: 30, weightLbs: 90 }) }))
  await h.add()
  assert.equal(h.items.length, 1)
  assert.equal(h.items[0].cubicFeet, 30)
  assert.equal(h.items[0].weightLbs, 90)
})

test('failed or empty dimension lookup preserves the draft and its error', async () => {
  for (const response of [{ ok: false, status: 401 }, { ok: true, json: async () => ({}) }]) {
    const h = harness(async () => response)
    await h.add()
    assert.equal(h.items.length, 0)
    assert.ok(h.error())
  }
})

test('repeated Add while a lookup is pending adds only one item', async () => {
  let resolve!: (value: unknown) => void
  const h = harness(() => new Promise(done => { resolve = done }))
  const pending = h.add()
  await h.add()
  resolve({ ok: true, json: async () => ({ cubicFeet: 30 }) })
  await pending
  assert.equal(h.items.length, 1)
  assert.equal(h.items[0].weightLbs, 120)
})


test('lookup displays cubic feet before adding an item', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ cubicFeet: 30, weightLbs: 90 }) }))
  await h.lookup()
  assert.equal(h.volume(), '30')
  assert.equal(h.items.length, 0)
})

test('changing the item or manually entering volume discards a late lookup', async () => {
  let resolve!: (value: unknown) => void
  const h = harness(() => new Promise(done => { resolve = done }))
  const pending = h.lookup()
  h.cancel()
  h.setVolume('12')
  resolve({ ok: true, json: async () => ({ cubicFeet: 30 }) })
  await pending
  assert.equal(h.volume(), '')
  await h.add()
  assert.equal(h.items[0].cubicFeet, 12)
})

test('Add reuses an already running automatic lookup', async () => {
  let resolve!: (value: unknown) => void
  let calls = 0
  const h = harness(() => { calls++; return new Promise(done => { resolve = done }) })
  const lookup = h.lookup()
  const adding = h.add()
  resolve({ ok: true, json: async () => ({ cubicFeet: 30, weightLbs: 90 }) })
  await Promise.all([lookup, adding])
  assert.equal(calls, 1)
  assert.equal(h.items.length, 1)
  assert.equal(h.items[0].cubicFeet, 30)
})

test('zero, negative and non-finite manual cubic feet cannot create an item', async () => {
  for (const value of ['0', '-1', 'Infinity']) {
    const h = harness(async () => { throw new Error('Should not look up manual values') })
    h.setVolume(value)
    await h.add()
    assert.equal(h.items.length, 0)
    assert.ok(h.error())
  }
})
