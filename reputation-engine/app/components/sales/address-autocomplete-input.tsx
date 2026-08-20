'use client'

import { useEffect, useRef, useState } from 'react'
import { selectedAddressCity } from '@/lib/address-city'

type Suggestion = {
  label: string
  city?: string
  country?: string
  countryCode?: 'ca' | 'us'
  placeType?: string
}

export function SalesAddressAutocompleteInput({
  value,
  placeholder,
  className,
  onSelect,
}: {
  value: string
  placeholder: string
  className?: string
  onSelect: (address: string, city?: string) => void
}) {
  const [raw, setRaw] = useState(value)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [fetching, setFetching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const focusedRef = useRef(false)
  const latestQueryRef = useRef('')

  useEffect(() => {
    if (!focusedRef.current) setRaw(value)
  }, [value])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  function handleChange(nextValue: string) {
    setRaw(nextValue)
    onSelect(nextValue)
    latestQueryRef.current = nextValue

    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (nextValue.length < 4) {
      setSuggestions([])
      setOpen(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setFetching(true)
      try {
        const response = await fetch(`/api/sales/address-suggest?q=${encodeURIComponent(nextValue)}`, { credentials: 'include' })
        const payload = (await response.json()) as { suggestions?: Suggestion[] }
        if (latestQueryRef.current !== nextValue) return
        const nextSuggestions = payload.suggestions || []
        setSuggestions(nextSuggestions)
        setOpen(nextSuggestions.length > 0)
      } catch {
        if (latestQueryRef.current !== nextValue) return
        setSuggestions([])
        setOpen(false)
      } finally {
        if (latestQueryRef.current === nextValue) setFetching(false)
      }
    }, 350)
  }

  function handleSelect(suggestion: Suggestion) {
    setRaw(suggestion.label)
    setSuggestions([])
    setOpen(false)
    onSelect(suggestion.label, selectedAddressCity(suggestion.label, suggestion.city))
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        className={className || 'crm-input mt-1.5'}
        placeholder={placeholder}
        value={raw}
        autoComplete="off"
        onChange={event => handleChange(event.target.value)}
        onFocus={() => {
          focusedRef.current = true
          if (suggestions.length > 0) setOpen(true)
        }}
        onBlur={() => {
          focusedRef.current = false
          onSelect(raw, selectedAddressCity(raw))
        }}
      />
      {fetching && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 mt-0.5">
          <span className="block h-3 w-3 animate-spin rounded-full border-2 border-[var(--app-accent)] border-t-transparent" />
        </span>
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 top-full z-[60] mt-1 max-h-64 w-[min(42rem,calc(100vw-2rem))] overflow-y-auto rounded-[8px] border border-[var(--app-line)] bg-white shadow-lg">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.label}-${index}`}
              type="button"
              onMouseDown={() => handleSelect(suggestion)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--app-bg)]"
            >
              <span className="text-[11px] shrink-0">
                {suggestion.placeType === 'apartment' ? '🏢' : suggestion.placeType === 'commercial' ? '🏬' : '🏠'}
              </span>
              <span className="min-w-0 flex-1 whitespace-normal break-words text-sm leading-5 text-[var(--app-ink)]">{suggestion.label}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${suggestion.countryCode === 'ca' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                {suggestion.countryCode === 'ca' ? 'Canada' : suggestion.countryCode === 'us' ? 'USA' : suggestion.country || 'Address'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
