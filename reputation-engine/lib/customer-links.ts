export function compactCustomerLink(value: string) {
  try {
    const url = new URL(value)
    if (url.pathname === '/quote-accept') {
      const id = url.searchParams.get('id')
      const token = url.searchParams.get('token')
      if (id && token) {
        const fastLane = url.searchParams.get('fastlane') === '1' ? '?fastlane=1' : ''
        return `${url.origin}/q/${encodeURIComponent(id)}/${encodeURIComponent(token)}${fastLane}`
      }
    }
    if (url.pathname.startsWith('/video-survey/')) {
      return `${url.origin}/v/${url.pathname.slice('/video-survey/'.length)}`
    }
    if (url.pathname.startsWith('/survey/')) {
      return `${url.origin}/p/${url.pathname.slice('/survey/'.length)}`
    }
  } catch {
    return value
  }
  return value
}
