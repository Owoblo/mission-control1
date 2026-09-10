export type MessagePart = { text: string; href?: string }

export function messageLinkParts(text: string): MessagePart[] {
  const parts: MessagePart[] = []
  const pattern = /\b(?:https?:\/\/|www\.)[^\s<>"\u201c\u201d]+/gi
  let end = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index!
    let label = match[0].replace(/[.,!?:;]+$/g, '')
    while (label.endsWith(')') && (label.match(/\)/g)?.length || 0) > (label.match(/\(/g)?.length || 0)) label = label.slice(0, -1)
    while (label.endsWith(']') && (label.match(/\]/g)?.length || 0) > (label.match(/\[/g)?.length || 0)) label = label.slice(0, -1)
    const href = /^www\./i.test(label) ? `https://${label}` : label
    try {
      const parsed = new URL(href)
      if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname) continue
    } catch { continue }
    if (start > end) parts.push({ text: text.slice(end, start) })
    parts.push({ text: label, href })
    end = start + label.length
  }
  if (end < text.length) parts.push({ text: text.slice(end) })
  return parts
}
