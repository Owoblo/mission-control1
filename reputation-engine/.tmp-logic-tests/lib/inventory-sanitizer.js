"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeInventoryRooms = sanitizeInventoryRooms;
exports.auditInventoryRooms = auditInventoryRooms;
// Items that strongly belong to a specific room
const ROOM_ANCHORS = [
    // Bedroom-only items
    {
        patterns: [/\bbed\s*frame\b/i, /\bqueen\s*bed\b/i, /\bking\s*bed\b/i, /\btwin\s*bed\b/i, /\bdouble\s*bed\b/i, /\bmattress\b/i, /\bnightstand\b/i, /\bnight\s*stand\b/i, /\bbedside\b/i],
        correctRoom: 'Bedroom',
        allowedRooms: ['bedroom', 'master bedroom', 'guest bedroom', 'kids bedroom', 'primary bedroom'],
    },
    // Dresser / wardrobe — bedroom
    {
        patterns: [/\bdresser\b/i, /\bwardrobe\b/i, /\barmoire\b/i, /\bchest\s*of\s*drawers\b/i],
        correctRoom: 'Bedroom',
        allowedRooms: ['bedroom', 'master bedroom', 'guest bedroom', 'closet', 'walk-in'],
    },
    // Sofa, sectional, armchair, loveseat — living room
    {
        patterns: [/\bsectional\b/i, /\b3[\s-]?seat\s*sofa\b/i, /\b2[\s-]?seat\s*sofa\b/i, /\bloveseat\b/i, /\bcouch\b/i, /\bsofa\b/i],
        correctRoom: 'Living Room',
        allowedRooms: ['living room', 'family room', 'great room', 'den', 'basement', 'rec room', 'sitting room', 'lounge'],
    },
    // Coffee table, end table, TV stand — living room
    {
        patterns: [/\bcoffee\s*table\b/i, /\bcenter\s*table\b/i, /\btv\s*stand\b/i, /\bmedia\s*console\b/i, /\bentertainment\s*center\b/i, /\bentertainment\s*unit\b/i],
        correctRoom: 'Living Room',
        allowedRooms: ['living room', 'family room', 'great room', 'den', 'basement', 'rec room', 'bedroom', 'office'],
    },
    // Dining table / dining chairs — dining room
    {
        patterns: [/\bdining\s*table\b/i, /\bdining\s*chair\b/i, /\bdining\s*bench\b/i, /\bdining\s*set\b/i],
        correctRoom: 'Dining Room',
        allowedRooms: ['dining room', 'eat-in kitchen', 'kitchen', 'dining area', 'breakfast nook'],
    },
    // Kitchen appliances — kitchen
    {
        patterns: [/\brefrigerator\b/i, /\bfridge\b/i, /\bstove\b/i, /\boven\b/i, /\bdishwasher\b/i, /\bmicrowave\b/i, /\brange\b/i, /\bkitchen\s*island\b/i],
        correctRoom: 'Kitchen',
        allowedRooms: ['kitchen', 'eat-in kitchen', 'kitchenette'],
    },
    // Washer / dryer — laundry
    {
        patterns: [/\bwasher\b/i, /\bdryer\b/i, /\bwashing\s*machine\b/i],
        correctRoom: 'Laundry',
        allowedRooms: ['laundry', 'laundry room', 'utility room', 'basement'],
    },
    // Outdoor / garage items
    {
        patterns: [/\bbicycle\b/i, /\bbike\b/i, /\blawn\s*mower\b/i, /\bsnow\s*blower\b/i, /\bgrill\b/i, /\bbarbecue\b/i, /\bpatio\s*set\b/i, /\bpatio\s*chair\b/i],
        correctRoom: 'Garage / Outdoor',
        allowedRooms: ['garage', 'outdoor', 'backyard', 'patio', 'basement'],
    },
];
const APARTMENT_AMENITY_ROOM_PATTERNS = [
    /\bamenit(y|ies)\b/i,
    /\bcommon\b/i,
    /\bshared\b/i,
    /\blobby\b/i,
    /\blounge\b/i,
    /\bconcierge\b/i,
    /\bmail\s*room\b/i,
    /\bparty\s*room\b/i,
    /\bgame\s*room\b/i,
    /\bbilliards?\b/i,
    /\bfitness\b/i,
    /\bgym\b/i,
    /\bpool\b/i,
    /\brooftop\b/i,
    /\bterrace\b/i,
    /\bcourtyard\b/i,
    /\bco[-\s]?working\b/i,
];
const APARTMENT_AMENITY_ITEM_PATTERNS = [
    /\bpool\s*table\b/i,
    /\bbilliards?\b/i,
    /\btreadmill\b/i,
    /\belliptical\b/i,
    /\bexercise\s*bike\b/i,
    /\bstationary\s*bike\b/i,
    /\bweight\s*(bench|rack|machine)\b/i,
    /\bgym\s*equipment\b/i,
    /\blobby\s*sofa\b/i,
    /\blounge\s*chair\b/i,
    /\bmailbox\b/i,
    /\bfront\s*desk\b/i,
];
const APARTMENT_AMENITY_NOTE = 'Likely apartment building amenity/common area from listing photos - not customer unit inventory.';
function normalizeRoom(room) {
    return room.toLowerCase().trim();
}
function isAllowedRoom(itemRoom, allowedRooms) {
    const normalized = normalizeRoom(itemRoom);
    return allowedRooms.some(allowed => normalized.includes(allowed.toLowerCase()));
}
function matchesPattern(itemName, patterns) {
    return patterns.some(p => p.test(itemName));
}
function appendNote(existing, note) {
    if (!existing)
        return note;
    return existing.toLowerCase().includes(note.toLowerCase()) ? existing : `${existing} ${note}`;
}
function isApartmentAmenityNoise(item) {
    if (item.policyOverride === 'include')
        return false;
    const name = item.name || item.item || '';
    const context = [
        item.room,
        item.sourcePhotoRoom,
        item.notes,
        item.confirmReason,
    ].filter(Boolean).join(' ');
    const amenityRoom = APARTMENT_AMENITY_ROOM_PATTERNS.some(pattern => pattern.test(context));
    if (amenityRoom)
        return true;
    return APARTMENT_AMENITY_ITEM_PATTERNS.some(pattern => pattern.test(name)) && /\b(apartment|condo|building|common|shared|amenity|lobby|lounge|gym|fitness|pool|billiard|party|rooftop)\b/i.test(context);
}
/**
 * Returns a corrected room label for an item if the current assignment is clearly wrong.
 * Returns null if no correction is needed.
 */
function correctRoom(item) {
    const name = item.name || item.item || '';
    const currentRoom = item.room || '';
    for (const anchor of ROOM_ANCHORS) {
        if (!matchesPattern(name, anchor.patterns))
            continue;
        if (!anchor.allowedRooms || isAllowedRoom(currentRoom, anchor.allowedRooms))
            continue;
        // Item is in a wrong room — suggest the correct one
        return anchor.correctRoom;
    }
    return null;
}
/**
 * Runs a sanity pass over the full inventory:
 * - corrects obvious room misclassifications
 * - excludes apartment amenity/common-area scan noise that should not count as customer inventory
 */
function sanitizeInventoryRooms(inventory) {
    return inventory.map(item => {
        if (isApartmentAmenityNoise(item)) {
            return {
                ...item,
                included: false,
                status: 'excluded',
                exclusionReason: item.exclusionReason || APARTMENT_AMENITY_NOTE,
                notes: appendNote(item.notes, APARTMENT_AMENITY_NOTE),
            };
        }
        const correction = correctRoom(item);
        const correctedItem = correction ? { ...item, room: correction } : item;
        return correctedItem;
    });
}
/** Returns a summary of corrections made, for debugging/logging */
function auditInventoryRooms(inventory) {
    const corrections = [];
    for (const item of inventory) {
        const correction = correctRoom(item);
        if (correction) {
            corrections.push({ name: item.name || item.item || '', from: item.room || '', to: correction });
        }
    }
    return corrections;
}
