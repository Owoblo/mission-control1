'use client'

import { useEffect, useRef, useState } from 'react'

type Suggestion = {
  label: string
  city?: string
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

  useEffect(() => {
    setRaw(value)
  }, [value])

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
        const nextSuggestions = payload.suggestions || []
        setSuggestions(nextSuggestions)
        setOpen(nextSuggestions.length > 0)
      } catch {
        setSuggestions([])
        setOpen(false)
      } finally {
        setFetching(false)
      }
    }, 350)
  }

  function handleSelect(suggestion: Suggestion) {
    setRaw(suggestion.label)
    setSuggestions([])
    setOpen(false)
    onSelect(suggestion.label, suggestion.city)
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        className={className || 'crm-input mt-1.5'}
        placeholder={placeholder}
        value={raw}
        autoComplete="off"
        onChange={event => handleChange(event.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
      />
      {fetching && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 mt-0.5">
          <span className="block h-3 w-3 animate-spin rounded-full border-2 border-[var(--app-accent)] border-t-transparent" />
        </span>
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 top-full z-[60] mt-1 w-full min-w-full max-w-[560px] overflow-y-auto rounded-[8px] border border-[var(--app-line)] bg-white shadow-xl sm:w-max">
          {suggestions.map((suggestion, index) => {
            const parts = suggestion.label.split(', ')
            const street = parts[0] || suggestion.label
            const location = parts.slice(1).join(', ')
            return (
              <button
                key={`${suggestion.label}-${index}`}
                type="button"
                onMouseDown={() => handleSelect(suggestion)}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-[var(--app-bg)]"
              >
                <span className="mt-0.5 text-[11px] shrink-0">
                  {suggestion.placeType === 'apartment' ? '🏢' : suggestion.placeType === 'commercial' ? '🏬' : '🏠'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--app-ink)]">{street}</div>
                  {location ? <div className="text-xs text-[var(--app-muted)]">{location}</div> : null}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
