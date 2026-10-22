export function partnershipMediaKind(url: string, metadata: Record<string, unknown> = {}) {
  const entries = [metadata.media, metadata.attachments].flatMap(value => Array.isArray(value) ? value : [])
  const entry = entries.find(value => value && typeof value === 'object' && value.url === url)
  const type = String(entry?.contentType || entry?.content_type || '').toLowerCase()
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('image/')) return 'image'
  const path = url.split(/[?#]/)[0]
  if (/\.(amr|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(path)) return 'audio'
  if (/\.(mp4|mov|webm|m4v|3gp)$/i.test(path)) return 'video'
  if (/\.(png|jpe?g|gif|webp|heic|heif)$/i.test(path)) return 'image'
  return 'file'
}
