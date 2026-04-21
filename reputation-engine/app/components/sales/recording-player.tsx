'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { getRecordingPlaybackUrl } from '@/lib/recording-playback'

interface RecordingPlayerProps {
  recordingUrl?: string | null
  className?: string
}

export function RecordingPlayer({ recordingUrl, className = 'w-full' }: RecordingPlayerProps) {
  const playbackUrl = useMemo(() => getRecordingPlaybackUrl(recordingUrl), [recordingUrl])
  const isLazyProxy = playbackUrl.startsWith('/api/sales/dialer/recording?')
  const [audioSrc, setAudioSrc] = useState(() => (isLazyProxy ? '' : playbackUrl))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    setError(null)

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }

    setAudioSrc(isLazyProxy ? '' : playbackUrl)

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [isLazyProxy, playbackUrl])

  async function loadRecording() {
    if (!playbackUrl || !isLazyProxy || loading || audioSrc) return

    try {
      setLoading(true)
      setError(null)
      const response = await fetch(playbackUrl, { credentials: 'include' })
      if (!response.ok) {
        throw new Error(`Recording unavailable (${response.status})`)
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      objectUrlRef.current = objectUrl
      setAudioSrc(objectUrl)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load recording')
    } finally {
      setLoading(false)
    }
  }

  if (!playbackUrl) return null

  return (
    <div className="space-y-2">
      {isLazyProxy && !audioSrc ? (
        <button
          type="button"
          onClick={() => void loadRecording()}
          disabled={loading}
          className="rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--app-ink)] transition hover:border-[var(--app-ink)] disabled:opacity-60"
        >
          {loading ? 'Loading recording…' : 'Load recording'}
        </button>
      ) : null}

      {audioSrc ? (
        <audio controls preload="none" className={className} src={audioSrc}>
          Your browser does not support audio playback.
        </audio>
      ) : null}

      {error ? <div className="text-xs text-rose-600">{error}</div> : null}
    </div>
  )
}
