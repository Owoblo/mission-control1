"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeVideoInventoryLabel = normalizeVideoInventoryLabel;
exports.normalizeVideoInventoryRoom = normalizeVideoInventoryRoom;
exports.videoInventoryDedupeKey = videoInventoryDedupeKey;
exports.clusterVideoInventoryCandidates = clusterVideoInventoryCandidates;
exports.reconcileVideoInventorySources = reconcileVideoInventorySources;
const ITEM_ALIASES = [
    [/\b(sectional|sofa|couch|loveseat|chesterfield)\b/g, 'sofa'],
    [/\b(television|flat screen|flatscreen)\b/g, 'tv'],
    [/\b(night stand|nightstand|bedside table)\b/g, 'nightstand'],
    [/\b(dining chair|kitchen chair)\b/g, 'chair'],
    [/\b(chest of drawers|bureau)\b/g, 'dresser'],
    [/\b(refrigerator|fridge)\b/g, 'fridge'],
    [/\b(washing machine|washer)\b/g, 'washer'],
    [/\b(tumble dryer|clothes dryer)\b/g, 'dryer'],
];
function normalizeVideoInventoryLabel(value) {
    let normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    for (const [pattern, replacement] of ITEM_ALIASES) {
        normalized = normalized.replace(pattern, replacement);
    }
    return normalized
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter((word, index, words) => index === 0 || word !== words[index - 1])
        .join(' ');
}
function normalizeVideoInventoryRoom(value) {
    const room = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const roomNumber = room.match(/\b(?:room|bedroom|storage|garage)\s*(\d+|one|two|three|four|five)\b/)?.[1];
    if (/garage|shed/.test(room))
        return 'garage';
    if (/basement|cellar/.test(room))
        return 'basement';
    if (/living|family|great room/.test(room))
        return 'living room';
    if (/dining/.test(room))
        return 'dining room';
    if (/bed|primary|master/.test(room)) {
        if (room.includes('primary') || room.includes('master'))
            return 'primary bedroom';
        return roomNumber ? `bedroom ${roomNumber}` : 'bedroom';
    }
    if (/kitchen/.test(room))
        return 'kitchen';
    if (/office|study/.test(room))
        return 'office';
    if (/storage|locker|container/.test(room))
        return roomNumber ? `storage ${roomNumber}` : 'storage';
    if (/patio|yard|outdoor|balcony/.test(room))
        return 'outdoor';
    return room || 'unassigned';
}
function videoInventoryDedupeKey(candidate) {
    return `${normalizeVideoInventoryRoom(candidate.room)}:${normalizeVideoInventoryLabel(candidate.itemName)}`;
}
function clusterVideoInventoryCandidates(candidates, windowMs = 90000) {
    const sorted = [...candidates].sort((a, b) => Number(a.offsetMs || 0) - Number(b.offsetMs || 0));
    const groups = new Map();
    for (const candidate of sorted) {
        const key = videoInventoryDedupeKey(candidate);
        const existingGroups = Array.from(groups.entries()).filter(([groupKey]) => groupKey.startsWith(`${key}:`));
        const lastGroup = existingGroups.at(-1);
        const lastOffset = lastGroup?.[1].at(-1)?.offsetMs;
        const isNearby = lastOffset == null || candidate.offsetMs == null || Math.abs(candidate.offsetMs - lastOffset) <= windowMs;
        const groupKey = isNearby && lastGroup ? lastGroup[0] : `${key}:${existingGroups.length + 1}`;
        const group = groups.get(groupKey) || [];
        group.push(candidate);
        groups.set(groupKey, group);
    }
    return Array.from(groups.entries()).map(([groupId, group]) => {
        const sourceKinds = new Set(group.map(item => item.sourceKind));
        const confidenceBoost = Math.min(0.12, Math.max(0, sourceKinds.size - 1) * 0.04);
        const best = [...group].sort((a, b) => b.confidence - a.confidence)[0];
        const dispositions = new Set(group.map(item => item.disposition));
        const disposition = dispositions.size === 1 ? best.disposition : 'uncertain';
        const duplicateConfidence = group.length > 1
            ? Math.min(0.98, 0.7 + Math.min(group.length, 4) * 0.06 + (sourceKinds.size > 1 ? 0.06 : 0))
            : 0;
        return {
            ...best,
            quantity: Math.max(...group.map(item => Math.max(1, item.quantity || 1))),
            disposition,
            confidence: Math.min(0.99, best.confidence + confidenceBoost),
            duplicateGroupId: group.length > 1 ? groupId : undefined,
            duplicateConfidence: group.length > 1 ? duplicateConfidence : undefined,
            evidenceIds: group.map(item => item.id),
        };
    });
}
function reconcileVideoInventorySources(input) {
    const combined = [
        ...input.video,
        ...(input.transcript || []),
        ...(input.listing || []),
        ...(input.photos || []),
        ...(input.manual || []),
    ];
    return clusterVideoInventoryCandidates(combined).sort((a, b) => {
        const roomOrder = normalizeVideoInventoryRoom(a.room).localeCompare(normalizeVideoInventoryRoom(b.room));
        return roomOrder || normalizeVideoInventoryLabel(a.itemName).localeCompare(normalizeVideoInventoryLabel(b.itemName));
    });
}
