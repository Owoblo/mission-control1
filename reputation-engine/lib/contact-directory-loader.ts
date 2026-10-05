/** Preserve a previous complete directory when a refresh fails partway through. */
export async function loadContactDirectory<T extends { id: string }>(options: {
  previous: T[]
  readPage: (offset: number) => Promise<{ contacts: T[]; total: number }>
  publish: (rows: T[]) => void
  pageSize?: number
}) {
  const collected: T[] = []
  const pageSize = options.pageSize ?? 500
  try {
    for (let offset = 0; ; offset += pageSize) {
      const page = await options.readPage(offset)
      if (!Array.isArray(page.contacts) || !Number.isFinite(page.total) || page.total < 0) {
        throw new Error('Invalid directory response')
      }
      collected.push(...page.contacts)
      if (!options.previous.length && offset === 0) options.publish([...collected])
      if (collected.length >= page.total) break
      if (page.contacts.length < pageSize) throw new Error('Incomplete directory response')
    }
    options.publish(collected)
  } catch (error) {
    // Do not turn an outage into an empty or truncated directory.
    if (collected.length) {
      const retained = new Map(options.previous.map(row => [row.id, row]))
      for (const row of collected) retained.set(row.id, row)
      options.publish([...retained.values()])
    }
    throw error
  }
}
