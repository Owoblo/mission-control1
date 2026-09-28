import assert from 'node:assert/strict'
import test from 'node:test'
import { readMlsScan } from '../../lib/mls-scan-stream'

function response(chunks: string[]) {
  return new Response(new ReadableStream({ start(controller) {
    chunks.forEach(chunk => controller.enqueue(new TextEncoder().encode(chunk)))
    controller.close()
  } }))
}

test('handles split SSE chunks and a completion without trailing newline', async () => {
  const progress: string[] = []
  const result = await readMlsScan(response([
    'data: {"type":"pro', 'gress","status":"Scanning"}\r\n\r\n',
    'data: {"type":"batch","items":[{"name":"Chair"}]}\n\n',
    'data: {"type":"done","allItems":[{"name":"Sofa"}]}',
  ]), event => progress.push(event.type))
  assert.deepEqual(progress, ['progress', 'batch'])
  assert.equal(result.allItems[0].name, 'Sofa')
})

test('interrupted streams never publish partial inventory', async () => {
  await assert.rejects(readMlsScan(response(['data: {"type":"batch","items":[{"name":"Chair"}]}\n']), () => {}), /ended before/)
})

test('a failed room prevents accepting an incomplete final inventory', async () => {
  await assert.rejects(readMlsScan(response([
    'data: {"type":"batch_error","error":"Room scan failed"}\n',
    'data: {"type":"done","allItems":[]}\n',
  ]), () => {}), /Room scan failed/)
})

test('malformed results, HTTP errors, and progress callback failures propagate', async () => {
  await assert.rejects(readMlsScan(response(['data: invalid\n']), () => {}), /invalid response/)
  await assert.rejects(readMlsScan(new Response('No MLS photos', { status: 400 }), () => {}), /No MLS photos/)
  await assert.rejects(readMlsScan(response(['data: {"type":"progress"}\n']), () => { throw new Error('callback failure') }), /callback failure/)
})
