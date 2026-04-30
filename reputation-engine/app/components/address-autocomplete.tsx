'use client'

import { useEffect, useRef } from 'react'

let mapsScriptState: 'idle' | 'loading' | 'ready' = 'idle'
const readyCallbacks: Array<() => void> = []

function onMapsReady(cb: () => void) {
  if (mapsScriptState === 'ready') { cb(); return }
  readyCallbacks.push(cb)
  if (mapsScriptState === 'loading') return
  mapsScriptState = 'loading'
  const key = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim()
  if (!key) return
  const script = document.createElement('script')
  script.id = 'gmp-script'
  script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`
  script.async = true
  script.defer = true
  script.onload = () => {
    mapsScriptState = 'ready'
    readyCallbacks.splice(0).forEach(fn => fn())
  }
  document.head.appendChild(script)
}

type Props = {
  value: string
  onChange: (value: string) => void
  onPlaceSelect?: (streetAddress: string, city: string) => void
  placeholder?: string
  className?: string
  country?: string
}

export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  placeholder = 'Address',
  className = 'crm-input',
  country = 'ca',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) return

    onMapsReady(() => {
      const el = inputRef.current
      if (!el) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).google
      if (!g?.maps?.places) return

      const ac = new g.maps.places.Autocomplete(el, {
        types: ['address'],
        componentRestrictions: { country },
        fields: ['address_components', 'formatted_address'],
      })

      ac.addListener('place_changed', () => {
        const place = ac.getPlace()
        if (!place?.address_components) return

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const get = (type: string) => place.address_components.find((c: any) => c.types.includes(type))

        const streetNum = get('street_number')?.long_name || ''
        const route = get('route')?.long_name || ''
        const city =
          get('locality')?.long_name ||
          get('sublocality_level_1')?.long_name ||
          get('administrative_area_level_3')?.long_name ||
          get('administrative_area_level_2')?.long_name ||
          ''

        const streetAddress = [streetNum, route].filter(Boolean).join(' ')
        const displayValue = streetAddress || place.formatted_address || ''

        onChange(displayValue)
        onPlaceSelect?.(streetAddress, city)
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country])

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      autoComplete="new-password"
    />
  )
}
