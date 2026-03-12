'use client'

import { inventoryCategoryCode, normalizeRoomName } from './helpers'
import type { InventoryItem } from '@/lib/types'

type Props = {
  item: InventoryItem
  index: number
  roomOptions: string[]
  onUpdate: (index: number, field: keyof InventoryItem, value: string) => void
  onToggle: (index: number) => void
  onRemove: (index: number) => void
}

export function InventoryItemRow({ item, index, roomOptions, onUpdate, onToggle, onRemove }: Props) {
  return (
    <div className={`rounded-2xl border px-4 py-4 ${item.included === false ? 'border-amber-200 bg-amber-50' : 'border-stone-200 bg-stone-50'}`}>
      <div className="grid gap-3 lg:grid-cols-[140px_minmax(0,1fr)_auto_auto]">
        <select value={normalizeRoomName(item.room)} onChange={event => onUpdate(index, 'room', event.target.value)} className="crm-input">
          {roomOptions.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <div className="flex min-w-0 items-center gap-3 rounded-[4px] border border-[var(--app-line)] bg-white px-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] bg-[var(--app-accent-soft)] text-[11px] font-semibold tracking-[0.12em] text-[var(--app-accent)]">
            {inventoryCategoryCode(item.name || item.item)}
          </div>
          <input
            value={item.name || item.item || ''}
            onChange={event => onUpdate(index, 'name', event.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-sm text-[var(--app-ink)] outline-none placeholder:text-stone-400"
            placeholder="Item name"
          />
        </div>
        <button onClick={() => onToggle(index)} className="crm-button">
          {item.included === false ? 'Include' : 'Exclude'}
        </button>
        <button onClick={() => onRemove(index)} className="crm-button">Remove</button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <div className="mb-1 crm-label">Qty</div>
          <input
            type="number"
            min="0"
            value={item.qty || 0}
            onChange={event => onUpdate(index, 'qty', event.target.value)}
            className="crm-input"
            placeholder="Qty"
          />
        </div>
        <div>
          <div className="mb-1 crm-label">Cubic Feet</div>
          <input
            type="number"
            min="0"
            value={item.cubicFeet || 0}
            onChange={event => onUpdate(index, 'cubicFeet', event.target.value)}
            className="crm-input"
            placeholder="Cu ft"
          />
        </div>
        <div>
          <div className="mb-1 crm-label">Weight (lbs)</div>
          <input
            type="number"
            min="0"
            value={item.weightLbs || 0}
            onChange={event => onUpdate(index, 'weightLbs', event.target.value)}
            className="crm-input"
            placeholder="Lbs"
          />
        </div>
      </div>
      {item.included === false ? (
        <div className="mt-2 text-xs text-amber-700">
          Excluded from pricing{item.exclusionReason ? `: ${item.exclusionReason}` : '.'}
        </div>
      ) : null}
    </div>
  )
}
