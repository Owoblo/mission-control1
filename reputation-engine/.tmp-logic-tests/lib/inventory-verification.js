"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SURVEY_ROOMS = void 0;
exports.canonicalizeSurveyRoomLabel = canonicalizeSurveyRoomLabel;
exports.buildSurveyRoomId = buildSurveyRoomId;
exports.buildInventoryVerificationChoiceKeyMap = buildInventoryVerificationChoiceKeyMap;
exports.buildInventoryVerificationSummary = buildInventoryVerificationSummary;
exports.buildInventoryVerificationActivity = buildInventoryVerificationActivity;
exports.applyInventoryVerificationToInventory = applyInventoryVerificationToInventory;
exports.buildSurveyVerificationPayload = buildSurveyVerificationPayload;
exports.DEFAULT_SURVEY_ROOMS = [
    { id: 'living_room', label: 'Living Room' },
    { id: 'dining_room', label: 'Dining Room' },
    { id: 'kitchen', label: 'Kitchen' },
    { id: 'bedroom_1', label: 'Bedroom 1' },
    { id: 'bedroom_2', label: 'Bedroom 2' },
    { id: 'bedroom_3', label: 'Bedroom 3' },
    { id: 'office', label: 'Office / Den' },
    { id: 'basement', label: 'Basement' },
    { id: 'garage', label: 'Garage' },
    { id: 'outdoor', label: 'Outdoor / Patio' },
    { id: 'laundry', label: 'Laundry Room' },
    { id: 'storage', label: 'Storage / Other' },
];
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}
function normalizeText(value) {
    return (value || '').trim();
}
function normalizeItemName(item) {
    return normalizeText(item.name || item.item || 'Item') || 'Item';
}
function normalizeSize(value) {
    return normalizeText(value || '').toLowerCase();
}
function canonicalDefaultRoomLabel(value) {
    const normalized = slugify(value);
    const match = exports.DEFAULT_SURVEY_ROOMS.find(room => room.id === normalized || slugify(room.label) === normalized);
    return match?.label;
}
function canonicalizeSurveyRoomLabel(value) {
    const trimmed = normalizeText(value);
    if (!trimmed)
        return 'Unassigned';
    return canonicalDefaultRoomLabel(trimmed) || trimmed;
}
function buildSurveyRoomId(label) {
    const canonical = canonicalizeSurveyRoomLabel(label);
    return canonicalDefaultRoomLabel(canonical)
        ? slugify(canonical)
        : `custom_${slugify(canonical) || 'room'}`;
}
function buildInventoryVerificationChoiceKeyMap(items) {
    const sorted = items
        .map((item, index) => ({
        index,
        room: canonicalizeSurveyRoomLabel(item.room),
        name: normalizeItemName(item),
        size: normalizeSize(item.size),
    }))
        .sort((left, right) => {
        const room = left.room.localeCompare(right.room);
        if (room !== 0)
            return room;
        const name = left.name.localeCompare(right.name);
        if (name !== 0)
            return name;
        const size = left.size.localeCompare(right.size);
        if (size !== 0)
            return size;
        return left.index - right.index;
    });
    const counters = new Map();
    const keys = new Map();
    for (const item of sorted) {
        const base = `${slugify(item.room || 'room')}::${slugify(item.name || 'item')}::${slugify(item.size || 'standard')}`;
        const nextOrdinal = (counters.get(base) || 0) + 1;
        counters.set(base, nextOrdinal);
        keys.set(item.index, `${base}::${nextOrdinal}`);
    }
    return keys;
}
function buildListingPhotoUrls(lead) {
    const rawPhotos = lead.supabaseListing?.carouselphotos || [];
    return rawPhotos
        .map(photo => {
        if (!photo)
            return null;
        if (typeof photo === 'string')
            return photo;
        if (typeof photo === 'object' && 'url' in photo && typeof photo.url === 'string')
            return photo.url;
        return null;
    })
        .filter((photo) => !!photo);
}
function buildInventoryVerificationSummary(verification) {
    const itemChoices = verification?.itemChoices || [];
    return {
        goingCount: itemChoices.filter(choice => choice.decision === 'going').length,
        notGoingCount: itemChoices.filter(choice => choice.decision === 'not_going').length,
        unsureCount: itemChoices.filter(choice => choice.decision === 'unsure').length,
        addedCount: verification?.addedItems?.length || 0,
        addressMismatch: verification?.addressConfirmed === false || !!verification?.addressMismatchNote?.trim(),
        completedAt: verification?.completedAt,
        lastUpdatedAt: verification?.lastUpdatedAt,
    };
}
function buildInventoryVerificationActivity(lead) {
    const verification = lead.inventoryVerification;
    if (!verification)
        return [];
    const baseInventory = (lead.inventory || []).filter(item => item.source !== 'customer_verification');
    const keyMap = buildInventoryVerificationChoiceKeyMap(baseInventory);
    const inventoryByChoiceKey = new Map();
    keyMap.forEach((value, index) => {
        const item = baseInventory[index];
        if (item && value)
            inventoryByChoiceKey.set(value, item);
    });
    const choiceEvents = (verification.itemChoices || [])
        .filter(choice => !!choice.updatedAt)
        .map(choice => {
        const item = inventoryByChoiceKey.get(choice.itemKey);
        const itemLabel = normalizeItemName(item || { name: 'Inventory item' });
        const roomLabel = canonicalizeSurveyRoomLabel(item?.room || 'Unassigned');
        const decisionLabel = choice.decision === 'going'
            ? 'confirmed this is moving'
            : choice.decision === 'not_going'
                ? 'marked this as staying behind'
                : 'flagged this for review';
        return {
            id: `choice:${choice.itemKey}:${choice.updatedAt}`,
            ts: choice.updatedAt,
            actor: choice.updatedBy || 'customer',
            kind: 'choice',
            title: itemLabel,
            detail: `${decisionLabel} · ${roomLabel}${choice.note ? ` · ${choice.note}` : ''}`,
        };
    });
    const addedItemEvents = (verification.addedItems || [])
        .filter(item => !!item.createdAt)
        .map(item => ({
        id: `added:${item.id}:${item.createdAt}`,
        ts: item.createdAt,
        actor: item.createdBy || 'customer',
        kind: 'added_item',
        title: `${item.name} added`,
        detail: `${Math.max(1, Number(item.qty || 1))} item${Math.max(1, Number(item.qty || 1)) === 1 ? '' : 's'} · ${canonicalizeSurveyRoomLabel(item.room)}${item.note ? ` · ${item.note}` : ''}`,
    }));
    const addressEvents = verification.addressMismatchNote?.trim()
        ? [{
                id: `address:${verification.lastUpdatedAt || verification.completedAt || verification.startedAt || 'now'}`,
                ts: verification.lastUpdatedAt || verification.completedAt || verification.startedAt || new Date().toISOString(),
                actor: 'customer',
                kind: 'address',
                title: 'Address mismatch flagged',
                detail: verification.addressMismatchNote.trim(),
            }]
        : [];
    return [...choiceEvents, ...addedItemEvents, ...addressEvents]
        .sort((left, right) => right.ts.localeCompare(left.ts));
}
function applyInventoryVerificationToInventory(inventory, verification) {
    const baseInventory = (inventory || []).filter(item => item.source !== 'customer_verification');
    const keyMap = buildInventoryVerificationChoiceKeyMap(baseInventory);
    const choiceByKey = new Map((verification?.itemChoices || []).map(choice => [choice.itemKey, choice]));
    const updatedInventory = baseInventory.map((item, index) => {
        const choice = choiceByKey.get(keyMap.get(index) || '');
        if (!choice)
            return item;
        const note = choice.note?.trim();
        if (choice.decision === 'not_going') {
            return {
                ...item,
                included: false,
                status: 'excluded',
                exclusionReason: 'Customer marked this as staying behind.',
                confirmReason: note || 'Customer marked this as staying behind.',
                notes: note || item.notes,
            };
        }
        if (choice.decision === 'unsure') {
            return {
                ...item,
                included: true,
                status: 'needs_confirmation',
                confirmReason: note || 'Customer was unsure whether this is moving.',
                notes: note || item.notes,
            };
        }
        return {
            ...item,
            included: true,
            status: 'confirmed',
            confirmReason: note || 'Customer confirmed this item is moving.',
            notes: note || item.notes,
        };
    });
    const addedItems = (verification?.addedItems || [])
        .filter(item => normalizeText(item.name))
        .map(item => ({
        id: item.id,
        room: canonicalizeSurveyRoomLabel(item.room),
        name: normalizeText(item.name),
        qty: Math.max(1, Number(item.qty || 1)),
        cubicFeet: undefined,
        weightLbs: undefined,
        included: true,
        status: 'confirmed',
        notes: item.note?.trim() || 'Added by customer during inventory verification.',
        source: 'customer_verification',
    }));
    return [...updatedInventory, ...addedItems];
}
function buildSurveyVerificationPayload(lead) {
    const verification = lead.inventoryVerification;
    const reviewInventory = (lead.inventory || []).filter(item => item.source !== 'customer_verification');
    const keyMap = buildInventoryVerificationChoiceKeyMap(reviewInventory);
    const choiceByKey = new Map((verification?.itemChoices || []).map(choice => [choice.itemKey, choice]));
    const roomSeeds = new Map();
    for (const room of exports.DEFAULT_SURVEY_ROOMS) {
        roomSeeds.set(room.label, {
            id: room.id,
            label: room.label,
            photoCount: 0,
            photos: [],
            items: [],
        });
    }
    const surveyAssets = (lead.mediaAssets || []).filter(asset => asset.kind === 'image' && (asset.source === 'survey' || asset.source === 'rep_upload'));
    for (const asset of surveyAssets) {
        const label = canonicalizeSurveyRoomLabel(asset.room || 'Unassigned');
        const existing = roomSeeds.get(label) || {
            id: buildSurveyRoomId(label),
            label,
            photoCount: 0,
            photos: [],
            items: [],
        };
        existing.photoCount += 1;
        existing.photos.push(asset.url);
        roomSeeds.set(label, existing);
    }
    reviewInventory.forEach((item, index) => {
        const label = canonicalizeSurveyRoomLabel(item.room || 'Unassigned');
        const existing = roomSeeds.get(label) || {
            id: buildSurveyRoomId(label),
            label,
            photoCount: 0,
            photos: [],
            items: [],
        };
        const key = keyMap.get(index) || `${buildSurveyRoomId(label)}_${index}`;
        const choice = choiceByKey.get(key);
        existing.items.push({
            key,
            room: label,
            name: normalizeItemName(item),
            qty: Math.max(1, Number(item.qty || 1)),
            decision: choice?.decision || null,
            note: choice?.note,
            included: item.included,
            status: item.status,
            confidence: item.confidence,
            size: item.size,
        });
        roomSeeds.set(label, existing);
    });
    const rooms = Array.from(roomSeeds.values())
        .filter(room => room.photoCount > 0 || room.items.length > 0 || exports.DEFAULT_SURVEY_ROOMS.some(seed => seed.label === room.label))
        .sort((left, right) => {
        const leftDefaultIndex = exports.DEFAULT_SURVEY_ROOMS.findIndex(seed => seed.label === left.label);
        const rightDefaultIndex = exports.DEFAULT_SURVEY_ROOMS.findIndex(seed => seed.label === right.label);
        if (leftDefaultIndex !== -1 && rightDefaultIndex !== -1)
            return leftDefaultIndex - rightDefaultIndex;
        if (leftDefaultIndex !== -1)
            return -1;
        if (rightDefaultIndex !== -1)
            return 1;
        return left.label.localeCompare(right.label);
    });
    return {
        leadId: lead.id,
        customerName: (lead.name || '').split(' ')[0] || 'there',
        originAddress: lead.originAddress || '',
        originCity: lead.originCity || '',
        destAddress: lead.destAddress || '',
        destCity: lead.destCity || '',
        moveDate: lead.moveDate || '',
        surveyCompletedAt: lead.surveyCompletedAt || null,
        surveyPhotoCount: Number(lead.surveyPhotoCount || 0),
        existingInventoryCount: reviewInventory.length,
        listingAddress: lead.supabaseListing?.address || '',
        listingPhotos: buildListingPhotoUrls(lead),
        verification,
        rooms,
    };
}
