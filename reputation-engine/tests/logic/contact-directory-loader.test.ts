import test from 'node:test'
import assert from 'node:assert/strict'
import { loadContactDirectory } from '../../lib/contact-directory-loader'

test('first-page outage never clears existing contacts', async () => {
  let published = false
  await assert.rejects(loadContactDirectory({
    previous: [{ id: 'old' }], readPage: async () => { throw new Error('down') },
    publish: () => { published = true },
  }))
  assert.equal(published, false)
})

test('partial refresh retains old contacts and applies successfully loaded updates', async () => {
  let rows = [{ id: 'a', name: 'old' }, { id: 'b', name: 'keep' }]
  await assert.rejects(loadContactDirectory({
    previous: rows, pageSize: 1,
    readPage: async offset => {
      if (offset) throw new Error('down')
      return { contacts: [{ id: 'a', name: 'updated' }], total: 2 }
    }, publish: next => { rows = next },
  }))
  assert.deepEqual(rows, [{ id: 'a', name: 'updated' }, { id: 'b', name: 'keep' }])
})

test('complete successful refresh replaces old rows, including a legitimately empty directory', async () => {
  let rows = [{ id: 'old' }]
  await loadContactDirectory({ previous: rows, readPage: async () => ({ contacts: [], total: 0 }), publish: next => { rows = next } })
  assert.deepEqual(rows, [])
})

test('initial load publishes its first page before completing subsequent pages', async () => {
  const snapshots: string[][] = []
  await loadContactDirectory({ previous: [], pageSize: 1,
    readPage: async offset => ({ contacts: [{ id: String(offset) }], total: 2 }),
    publish: rows => snapshots.push(rows.map(row => row.id)),
  })
  assert.deepEqual(snapshots, [['0'], ['0', '1']])
})

test('short pages with outstanding records are treated as incomplete', async () => {
  await assert.rejects(loadContactDirectory({ previous: [],
    readPage: async () => ({ contacts: [], total: 33_053 }), publish: () => {},
  }), /Incomplete/)
})
