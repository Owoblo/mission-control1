'use client'

import { InventoryItemRow } from './inventory-item-row'
import type { InventoryItem } from '@/lib/types'

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
  roomOptions,
  onAddToRoom,
  onUpdateItem,
  onToggleItem,
  onRemoveItem,
}: Props) {
  const roomTotals = roomItems.reduce(
    (totals, entry) => {
      if (entry.item.included === false) return totals
      const qty = Math.max(1, Number(entry.item.qty || 1))
      totals.items += qty
      totals.cubicFeet += qty * Number(entry.item.cubicFeet || 0)
      totals.weightLbs += qty * Number(entry.item.weightLbs || 0)
      return totals
    },
    { items: 0, cubicFeet: 0, weightLbs: 0 }
  )

  return (
    <div className="crm-subsection">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="crm-label">{roomName}</div>
          <div className="mt-1 text-xs text-stone-500">
            {roomItems.length} lines · {roomTotals.items} items · {Math.round(roomTotals.cubicFeet)} cu ft · {Math.round(roomTotals.weightLbs)} lbs
          </div>
        </div>
        <button onClick={() => onAddToRoom(roomName)} className="crm-button">Add to room</button>
      </div>
      <div className="mt-4 space-y-3">
        {roomItems.map(({ item, index }) => (
          <InventoryItemRow
            key={item.id || index}
            item={item}
            index={index}
            roomOptions={roomOptions}
            onUpdate={onUpdateItem}
            onToggle={onToggleItem}
            onRemove={onRemoveItem}
          />
        ))}
      </div>
    </div>
  )
}
