'use client'

import { useState } from 'react'
import type { InventoryItem } from '@/lib/types'

const CATEGORY_EMOJI: Record<string, string> = {
  SF: '🛋️',
  BD: '🛏️',
  DR: '🗄️',
  TB: '🪑',
  CH: '🪑',
  BX: '📦',
  TV: '📺',
  AP: '🏠',
  SP: '⚠️',
  IT: '📦',
}

function itemEmoji(name?: string) {
  const v = (name || '').toLowerCase()
  if (v.includes('sofa') || v.includes('sectional') || v.includes('couch') || v.includes('loveseat')) return '🛋️'
  if (v.includes('bed') || v.includes('mattress')) return '🛏️'
  if (v.includes('nightstand') || v.includes('end table')) return '🛏️'
  if (v.includes('dresser') || v.includes('wardrobe') || v.includes('armoire')) return '🗄️'
  if (v.includes('cabinet') || v.includes('hutch') || v.includes('shelf') || v.includes('bookcase')) return '🗄️'
  if (v.includes('dining table') || v.includes('kitchen table')) return '🍽️'
  if (v.includes('desk') || v.includes('office')) return '💼'
  if (v.includes('table') || v.includes('coffee')) return '🪑'
  if (v.includes('chair') || v.includes('stool') || v.includes('ottoman')) return '🪑'
  if (v.includes('box') || v.includes('bin') || v.includes('tote')) return '📦'
  if (v.includes('tv') || v.includes('television') || v.includes('monitor')) return '📺'
  if (v.includes('fridge') || v.includes('refrigerator') || v.includes('freezer')) return '🧊'
  if (v.includes('washer') || v.includes('dryer') || v.includes('dishwasher')) return '🔧'
  if (v.includes('stove') || v.includes('oven') || v.includes('microwave')) return '🍳'
  if (v.includes('piano')) return '🎹'
  if (v.includes('treadmill') || v.includes('gym') || v.includes('exercise')) return '🏋️'
  if (v.includes('safe')) return '🔒'
  if (v.includes('plant') || v.includes('tree')) return '🌿'
  if (v.includes('lamp') || v.includes('light')) return '💡'
  if (v.includes('mirror')) return '🪞'
  if (v.includes('bike') || v.includes('bicycle')) return '🚲'
  return '📦'
}

type Props = {
  item: InventoryItem
  index: number
  onUpdate: (index: number, field: keyof InventoryItem, value: string) => void
  onToggle: (index: number) => void
  onRemove: (index: number) => void
}

export function InventoryItemRow({ item, index, onUpdate, onToggle, onRemove }: Props) {
  const [editing, setEditing] = useState(false)
  const qty = Math.max(1, Number(item.qty || 1))
  const cuFt = Number(item.cubicFeet || 0)
  const lbs = Number(item.weightLbs || 0)
  const excluded = item.included === false

  return (
    <div className={excluded ? 'opacity-50' : ''}>
      {/* Compact row */}
      <div className="flex items-center gap-2 py-1.5 group">
        {/* Emoji icon */}
        <span className="w-6 text-center text-base shrink-0 select-none">{itemEmoji(item.name || item.item)}</span>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={item.name || item.item || ''}
              onChange={e => onUpdate(index, 'name', e.target.value)}
              className="w-full border-0 border-b border-stone-300 bg-transparent text-sm font-medium text-stone-900 outline-none focus:border-stone-600 py-0.5"
              placeholder="Item name"
            />
          ) : (
            <span className="text-sm font-medium text-stone-900 truncate block">{item.name || item.item}</span>
          )}
          {!editing && (
            <div className="mt-0.5 space-y-0.5">
              {item.size && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-stone-400">📐</span>
                  <span className="text-[11px] text-stone-500 font-medium">{item.size}</span>
                </div>
              )}
              <div className="text-[11px] text-stone-400 truncate">
                {[cuFt > 0 ? `${cuFt} cu ft` : '', lbs > 0 ? `${lbs} lbs` : ''].filter(Boolean).join(' · ')}
                {excluded ? ' · excluded' : null}
              </div>
              {item.notes && (
                <div className="text-[11px] text-stone-400 truncate italic">{item.notes}</div>
              )}
            </div>
          )}
        </div>

        {/* Qty stepper */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => qty > 1 && onUpdate(index, 'qty', String(qty - 1))}
            className="w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors disabled:opacity-30"
            disabled={qty <= 1}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" /></svg>
          </button>
          <span className="w-6 text-center text-sm text-stone-700 font-medium tabular-nums">{qty}</span>
          <button
            onClick={() => onUpdate(index, 'qty', String(qty + 1))}
            className="w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          </button>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Include/Exclude toggle — always visible in compact row */}
          {!editing && (
            <button
              onClick={() => onToggle(index)}
              title={excluded ? 'Include in move' : 'Exclude from move'}
              className={`rounded px-2 py-0.5 text-[10px] font-semibold border transition-colors ${
                excluded
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                  : 'text-stone-400 bg-stone-50 border-stone-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200'
              }`}
            >
              {excluded ? 'Include' : 'Exclude'}
            </button>
          )}
          <button
            onClick={() => setEditing(e => !e)}
            title={editing ? 'Done' : 'Edit'}
            className={`rounded p-1 text-xs transition-colors ${editing ? 'text-emerald-600 hover:bg-emerald-50' : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100'}`}
          >
            {editing ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
            )}
          </button>
          <button
            onClick={() => onRemove(index)}
            title="Remove"
            className="rounded p-1 text-stone-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
          </button>
        </div>
      </div>

      {/* Expanded edit: cu ft + lbs + notes */}
      {editing && (
        <div className="ml-8 mb-2 space-y-1.5">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              <span className="text-[11px] text-stone-400">Cu ft</span>
              <input
                type="number"
                min="0"
                value={cuFt}
                onChange={e => onUpdate(index, 'cubicFeet', e.target.value)}
                className="w-16 rounded border border-stone-200 px-1.5 py-0.5 text-sm text-stone-900 outline-none focus:border-stone-400"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[11px] text-stone-400">Lbs</span>
              <input
                type="number"
                min="0"
                value={lbs}
                onChange={e => onUpdate(index, 'weightLbs', e.target.value)}
                className="w-16 rounded border border-stone-200 px-1.5 py-0.5 text-sm text-stone-900 outline-none focus:border-stone-400"
              />
            </label>
            <button onClick={() => onToggle(index)} className="text-[11px] text-stone-400 hover:text-stone-700 underline underline-offset-2">
              {excluded ? 'Include' : 'Exclude'}
            </button>
          </div>
          <input
            value={item.size || ''}
            onChange={e => onUpdate(index, 'size', e.target.value)}
            className="w-full rounded border border-stone-200 px-2 py-1 text-[11px] text-stone-600 outline-none focus:border-stone-400 placeholder:text-stone-300"
            placeholder="Size — e.g. Queen (60×80 in), 6-drawer, 65 inch..."
          />
          <input
            value={item.notes || ''}
            onChange={e => onUpdate(index, 'notes', e.target.value)}
            className="w-full rounded border border-stone-200 px-2 py-1 text-[11px] text-stone-600 outline-none focus:border-stone-400 placeholder:text-stone-300"
            placeholder="Notes — condition, special handling, access issues..."
          />
        </div>
      )}
    </div>
  )
}
