/** Bounded, stable pagination. A cap or malformed page is an error, never an empty portfolio. */
export async function readCompleteRest<T extends { id: string }>(
  endpoint: string,
  headers: Record<string, string>,
  fetcher: typeof fetch = fetch,
  maxRows = 100000,
  key = 'id',
): Promise<T[]> {
  const rows: T[] = []
  const ids = new Set<string>()
  for (;;) {
    const url = new URL(endpoint)
    url.searchParams.set('order', `${key}.asc`)
    url.searchParams.set('limit', '500')
    if (rows.length) url.searchParams.set(key, `gt.${encodeURIComponent(String((rows[rows.length - 1] as Record<string, unknown>)[key]))}`)
    const response = await fetcher(url.toString(), { headers, cache: 'no-store' })
    if (!response.ok) throw new Error(`Context read failed (${response.status})`)
    const page: T[] = await response.json()
    if (!Array.isArray(page)) throw new Error('Invalid context page')
    if (!page.length) return rows
    for (const row of page) {
      const id = String((row as Record<string, unknown>)[key] || '')
      if (!id || ids.has(id)) throw new Error('Unstable context pagination')
      ids.add(id)
      rows.push(row)
      if (rows.length > maxRows) throw new Error('Context exceeds bounded read; narrow the scope')
    }
  }
}
