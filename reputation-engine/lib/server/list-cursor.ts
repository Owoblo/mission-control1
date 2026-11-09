import { createHash } from 'node:crypto'

export function cursorScope(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}

export function encodeListCursor(id: string, scope: string) {
  return Buffer.from(JSON.stringify({ v: 1, id, scope })).toString('base64url')
}

export function decodeListCursor(value: string | null, scope: string): string | null {
  if (!value) return null
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid cursor')
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (cursor.v !== 1 || cursor.scope !== scope || typeof cursor.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(cursor.id)) throw new Error()
    return cursor.id
  } catch { throw new Error('Invalid cursor; restart this search') }
}
