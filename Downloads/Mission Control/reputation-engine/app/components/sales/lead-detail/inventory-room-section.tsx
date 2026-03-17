'use client'

import { InventoryItemRow } from './inventory-item-row'
import type { InventoryItem } from '@/lib/types'

function roomEmoji(name: string) {
  const v = name.toLowerCase()
  if (v.includes('bedroom') || v.includes('master')) return '🛏️'
  if (v.includes('living') || v.includes('lounge')) return '🛋️'
  if (v.includes('kitchen') || v.includes('dining')) return '🍽️'
  if (v.includes('bathroom') || v.includes('washroom')) return '🚿'
  if (v.includes('garage') || v.includes('carport')) return '🚗'
  if (v.includes('office') || v.includes('study')) return '💼'
  if (v.includes('basement') || v.includes('utility')) return '🔧'
  if (v.includes('outdoor') || v.includes('patio') || v.includes('deck')) return '🌿'
  if (v.includes('storage')) return '📦'
  return '🏠'
}

type RoomEntry = {
  item: InventoryItem
  index: number
}

type Props = {
  roomName: string
  roomItems: RoomEntry[]
  roomOptions: string[]
  onAddToRoom: (roomName: string) => void
  onUpdateItem: (index: number, field: keyof InventoryItem, value: string) => void
  onToggleItem: (index: number) => void
  onRemoveItem: (index: number) => void
}

export function InventoryRoomSection({
  roomName,
  roomItems,
  onAddToRoom,
  onUpdateItem,
  onToggleItem,
  onRemoveItem,
}: Props) {
  const included = roomItems.filter(e => e.item.included !== false)
  const totalItems = included.reduce((s, e) => s + Math.max(1, Number(e.item.qty || 1)), 0)
  const totalCuFt = included.reduce((s, e) => s + Math.max(1, Number(e.item.qty || 1)) * Number(e.item.cubicFeet || 0), 0)

  return (
    <div>
      {/* Room header */}
      <div className="flex items-center justify-between py-2 border-b border-stone-200">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{roomEmoji(roomName)}</span>
          <span className="text-sm font-semibold text-stone-800 capitalize">{roomName.replace(/_/g, ' ')}</span>
          <span className="text-[11px] text-stone-400 ml-1">{totalItems} item{totalItems !== 1 ? 's' : ''} · {Math.round(totalCuFt)} cu ft</span>
        </div>
        <button
          onClick={() => onAddToRoom(roomName)}
          className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-900 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          Add
        </button>
      </div>

      {/* Item rows */}
      <div className="divide-y divide-stone-100">
        {roomItems.map(({ item, index }) => (
          <InventoryItemRow
            key={item.id || index}
            item={item}
            index={index}
            onUpdate={onUpdateItem}
            onToggle={onToggleItem}
            onRemove={onRemoveItem}
          />
        ))}
      </div>
    </div>
  )
}
