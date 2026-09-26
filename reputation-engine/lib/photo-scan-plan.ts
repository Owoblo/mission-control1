/** Group only canonical photos, after exact-file deduplication across the upload. */
export function buildPhotoScanPlan<T extends { url: string; room?: string }>(assets: T[], canonicalUrls: string[]) {
  const allowed = new Set(canonicalUrls.map(url => url.trim()))
  const seen = new Set<string>()
  const byRoom = new Map<string, string[]>()
  const duplicateAssets: T[] = []
  for (const asset of assets) {
    const url = asset.url.trim()
    if (!allowed.has(url) || seen.has(url)) {
      duplicateAssets.push(asset)
      continue
    }
    seen.add(url)
    const room = asset.room?.trim() || 'other'
    byRoom.set(room, [...(byRoom.get(room) || []), url])
  }
  return { byRoom, duplicateAssets }
}
