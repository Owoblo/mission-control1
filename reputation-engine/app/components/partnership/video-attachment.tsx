'use client'

import { useEffect, useState } from 'react'

const requests = new Map<string, Promise<string>>()
function prepare(touchId: string, url: string) {
  const key = `${touchId}:${url}`
  const existing = requests.get(key)
  if (existing) return existing
  const request = fetch('/api/marketing/video-playback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ touchId, url }),
  }).then(async response => {
    const result = await response.json()
    if (!response.ok || !result.url) throw new Error(result.error || 'Could not prepare video.')
    return result.url as string
  }).catch(error => { requests.delete(key); throw error })
  requests.set(key, request)
  return request
}

export function VideoAttachment({ touchId, source, original }: { touchId: string; source: string; original: string }) {
  const [convert, setConvert] = useState(/\.(3gp|3gpp|3g2|mov|avi)(?:[?#]|$)/i.test(original))
  const [playback, setPlayback] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!convert) return
    let active = true
    setError('')
    prepare(touchId, original).then(url => { if (active) setPlayback(url) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not prepare video.') })
    return () => { active = false }
  }, [convert, touchId, original, attempt])
  const preparing = convert && !playback && !error
  return <div>
    {preparing && <p role="status" className="rounded-xl bg-black/5 p-4 text-sm">Preparing video for playback…</p>}
    {!preparing && !error && <video key={playback || source} src={playback || source} controls playsInline preload="metadata"
      className="max-h-64 max-w-full rounded-[12px] bg-black" onError={() => {
        if (!convert) setConvert(true)
        else setError('The video could not be played. Try opening it separately or download the original.')
      }} />}
    {error && <p role="alert" className="mt-1 text-sm">{error}{' '}
      <button type="button" className="underline" onClick={() => {
        requests.delete(`${touchId}:${original}`); setPlayback(''); setError(''); setAttempt(value => value + 1)
      }}>Retry</button>
    </p>}
    {(!convert || playback) && <a href={playback || source} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm underline">Open video</a>}
    <a href={source} target="_blank" rel="noreferrer" className="ml-3 mt-1 inline-block text-sm underline">Original video</a>
  </div>
}
