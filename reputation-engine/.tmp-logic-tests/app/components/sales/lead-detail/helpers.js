"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ROOM_OPTIONS = exports.ROOM_DISPLAY_ORDER = void 0;
exports.normalizeRoomName = normalizeRoomName;
exports.roomDisplayOrder = roomDisplayOrder;
exports.buildRoomBreakdown = buildRoomBreakdown;
exports.buildLeadSignature = buildLeadSignature;
exports.inventoryCategoryCode = inventoryCategoryCode;
// Human-readable display labels for rooms — ordered for UI display
exports.ROOM_DISPLAY_ORDER = [
    'Kitchen',
    'Living Room',
    'Dining Room',
    'Primary Bedroom',
    'Bedroom 1',
    'Bedroom 2',
    'Bedroom 3',
    'Bedroom 4',
    'Bedroom 5',
    'Bathroom 1',
    'Bathroom 2',
    'Office',
    'Basement',
    'Garage',
    'Laundry',
    'Storage',
    'Outdoor',
    'Other',
    'Unassigned',
];
// Slug → display label map for AI-generated room IDs
const ROOM_SLUG_MAP = {
    kitchen_main: 'Kitchen',
    kitchen: 'Kitchen',
    living_room_main: 'Living Room',
    living_room: 'Living Room',
    family_room_main: 'Living Room',
    family_room: 'Living Room',
    dining_room_main: 'Dining Room',
    dining_room: 'Dining Room',
    bedroom_1: 'Bedroom 1',
    bedroom_2: 'Bedroom 2',
    bedroom_3: 'Bedroom 3',
    bedroom_4: 'Bedroom 4',
    bedroom_5: 'Bedroom 5',
    primary_bedroom: 'Primary Bedroom',
    master_bedroom: 'Primary Bedroom',
    bathroom_1: 'Bathroom 1',
    bathroom_2: 'Bathroom 2',
    bathroom: 'Bathroom 1',
    office: 'Office',
    laundry: 'Laundry',
    garage: 'Garage',
    basement: 'Basement',
    basement_rec: 'Basement',
    basement_living_area: 'Basement',
    living_room_basement: 'Basement',
    living_room_theatre: 'Living Room',
    storage: 'Storage',
    outdoor: 'Outdoor',
    other: 'Other',
    unknown_living_area: 'Other',
};
exports.DEFAULT_ROOM_OPTIONS = [
    'Kitchen',
    'Living Room',
    'Dining Room',
    'Primary Bedroom',
    'Bedroom 1',
    'Bedroom 2',
    'Bedroom 3',
    'Bedroom 4',
    'Bathroom 1',
    'Bathroom 2',
    'Office',
    'Basement',
    'Garage',
    'Laundry',
    'Storage',
    'Outdoor',
    'Other',
];
function normalizeRoomName(value) {
    if (!value?.trim())
        return 'Unassigned';
    const slug = value.trim().toLowerCase().replace(/\s+/g, '_');
    // Direct slug match
    if (ROOM_SLUG_MAP[slug])
        return ROOM_SLUG_MAP[slug];
    // Already human-readable (contains spaces or capitals)
    if (/[A-Z]/.test(value) || value.includes(' '))
        return value.trim();
    // Convert underscore_slug → Title Case as fallback
    return value.trim().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function roomDisplayOrder(roomName) {
    const idx = exports.ROOM_DISPLAY_ORDER.indexOf(roomName);
    return idx >= 0 ? idx : exports.ROOM_DISPLAY_ORDER.length;
}
function buildRoomBreakdown(inventory) {
    return inventory.reduce((rooms, item) => {
        if (item.included === false)
            return rooms;
        const room = normalizeRoomName(item.room);
        rooms[room] = (rooms[room] || 0) + Math.max(1, Number(item.qty || 1));
        return rooms;
    }, {});
}
function buildLeadSignature(payload) {
    return JSON.stringify(payload);
}
function inventoryCategoryCode(itemName) {
    const value = (itemName || '').toLowerCase();
    if (value.includes('sofa') || value.includes('sectional') || value.includes('couch') || value.includes('loveseat'))
        return 'SF';
    if (value.includes('bed') || value.includes('mattress') || value.includes('nightstand'))
        return 'BD';
    if (value.includes('dresser') || value.includes('wardrobe') || value.includes('cabinet') || value.includes('hutch'))
        return 'DR';
    if (value.includes('table') || value.includes('desk'))
        return 'TB';
    if (value.includes('chair') || value.includes('stool'))
        return 'CH';
    if (value.includes('box') || value.includes('bin') || value.includes('tote'))
        return 'BX';
    if (value.includes('tv') || value.includes('monitor'))
        return 'TV';
    if (value.includes('freezer') || value.includes('fridge'))
        return 'AP';
    if (value.includes('piano') || value.includes('safe') || value.includes('treadmill'))
        return 'SP';
    return 'IT';
}
