'use client'

import { useEffect, useCallback } from 'react'

type Props = {
  photos: string[]
  index: number
  onClose: () => void
  onNavigate: (index: number) => void
  labels?: string[]  // optional per-photo label (room name, source, etc.)
}

export function PhotoLightbox({ photos, index, onClose, onNavigate, labels }: Props) {
  const total = photos.length

  const prev = useCallback(() => onNavigate((index - 1 + total) % total), [index, total, onNavigate])
  const next = useCallback(() => onNavigate((index + 1) % total), [index, total, onNavigate])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next()
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prev()
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, onClose])

  if (!photos[index]) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Main image */}
      <div
        className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center"
        onClick={e => e.stopPropagation()}
      >
        <img
          src={photos[index]}
          alt={labels?.[index] || `Photo ${index + 1}`}
          className="max-h-[80vh] max-w-[85vw] rounded-[10px] object-contain shadow-2xl"
        />

        {/* Label + counter */}
        <div className="mt-3 flex items-center gap-3 text-white/80">
          {labels?.[index] && <span className="text-sm font-medium">{labels[index]}</span>}
          <span className="text-xs opacity-60">{index + 1} / {total}</span>
        </div>

        {/* Thumbnail strip */}
        {total > 1 && (
          <div className="mt-3 flex max-w-[85vw] gap-1.5 overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <button
                key={i}
                onClick={() => onNavigate(i)}
                className={`h-12 w-12 shrink-0 overflow-hidden rounded-[6px] border-2 transition ${i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-90'}`}
              >
                <img src={p} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Prev / Next */}
      {total > 1 && (
        <>
          <button
            onClick={e => { e.stopPropagation(); prev() }}
            className="absolute left-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/30 transition text-lg"
          >
            ‹
          </button>
          <button
            onClick={e => { e.stopPropagation(); next() }}
            className="absolute right-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/30 transition text-lg"
          >
            ›
          </button>
        </>
      )}

      {/* Close */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/30 transition"
      >
        ✕
      </button>

      {/* Keyboard hint */}
      {total > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] text-white/40">
          ← → arrow keys to navigate · Esc to close
        </div>
      )}
    </div>
  )
}
