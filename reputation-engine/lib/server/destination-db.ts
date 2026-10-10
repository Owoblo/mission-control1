import { requireSupabaseEnv } from './runtime'

export async function destinationDb<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init, headers: { ...headers, Prefer: 'return=representation', ...init?.headers },
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`Destination database operation failed (${response.status})`)
  return response.status === 204 ? undefined as T : response.json()
}
