"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractCustomerInventoryItems = extractCustomerInventoryItems;
exports.resolveInboundSalesContext = resolveInboundSalesContext;
const sales_1 = require("./sales");
const sales_automation_qualification_1 = require("./sales-automation-qualification");
const ADDRESS_SPLIT_RE = /\s+(?:to|->|→|drop\s*off\s*(?:is|:)?|dropoff\s*(?:is|:)?)\s+/i;
const PICKUP_RE = /\b(pick\s*up|pickup|origin|from)\b/i;
const DROPOFF_RE = /\b(drop\s*off|dropoff|destination|to)\b/i;
const ADDRESS_HINT_RE = /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|cres|crescent|ct|court|ln|lane|way|pkwy|parkway|pl|place|terrace|trail|circle|cir|sq|square|hwy|highway|unit|suite|apt|apartment|#)\b/i;
const INVENTORY_HINT_RE = /\b(sofa|couch|recliner|chair|table|tv|television|computer|desk|dishwasher|microwave|bicycle|bike|closet|bed|mattress|dresser|nightstand|bookshelf|shelf|boxes|box|wardrobe|fridge|freezer|stove|washer|dryer|cabinet)\b/i;
function cleanLine(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}
function trimAddressCandidate(value) {
    return value
        .replace(/^[^\d]*(?=\d)/, '')
        .replace(/\s+(?:and|also|that is|that’s|thats)\b.*$/i, '')
        .replace(/[.;]+$/g, '')
        .trim();
}
function firstCompleteAddress(value) {
    const text = trimAddressCandidate(cleanLine(value));
    if (!text || !/\d{1,6}/.test(text) || (!(0, sales_automation_qualification_1.hasStreetType)(text) && !(0, sales_automation_qualification_1.hasCanadianPostalCode)(text) && !ADDRESS_HINT_RE.test(text)))
        return '';
    if (!(0, sales_automation_qualification_1.hasCompleteMoveAddress)(text))
        return '';
    return text;
}
function extractRouteAddresses(message) {
    const text = cleanLine(message);
    if (!text)
        return {};
    const splitParts = text.split(ADDRESS_SPLIT_RE).map(part => part.trim()).filter(Boolean);
    if (splitParts.length >= 2) {
        const originAddress = firstCompleteAddress(splitParts[0]);
        const destAddress = firstCompleteAddress(splitParts.slice(1).join(' '));
        if (originAddress && destAddress)
            return { originAddress, destAddress };
    }
    const single = firstCompleteAddress(text);
    if (!single)
        return {};
    if (PICKUP_RE.test(text) && !DROPOFF_RE.test(text.replace(PICKUP_RE, '')))
        return { originAddress: single };
    if (DROPOFF_RE.test(text) && !PICKUP_RE.test(text.replace(DROPOFF_RE, '')))
        return { destAddress: single };
    return {};
}
function titleCase(value) {
    return value
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, char => char.toUpperCase());
}
function normalizeInventoryName(value) {
    let text = value
        .toLowerCase()
        .replace(/\b(recline)\b/g, 'recliner')
        .replace(/\b(tv)\b/g, 'television')
        .replace(/\bthere are\b|\bthere is\b|\bsome\b|\bitems?\b|\balso\b|\bthe\b|\ba\b|\ban\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (/closet/.test(text))
        text = 'closet items';
    if (!text || text.length < 3)
        return '';
    return titleCase(text);
}
function extractCustomerInventoryItems(message) {
    const text = cleanLine(message);
    if (!text || !INVENTORY_HINT_RE.test(text))
        return [];
    if (/\b(address|pick\s*up|pickup|drop\s*off|dropoff|postal|zip)\b/i.test(text) && !/\b(sofa|couch|chair|table|boxes|closet|packing|pack)\b/i.test(text))
        return [];
    const normalized = text
        .replace(/\bcoffee\s*,\s*table\b/gi, 'coffee table')
        .replace(/\bstudy\s*,\s*chair\b/gi, 'study chair')
        .replace(/\band\b/gi, ',');
    const seen = new Set();
    return normalized
        .split(',')
        .map(normalizeInventoryName)
        .filter(name => {
        const key = name.toLowerCase();
        if (!name || seen.has(key))
            return false;
        seen.add(key);
        return true;
    })
        .map((name, index) => ({
        id: `customer-sms-${Date.now()}-${index}`,
        name,
        item: name,
        room: 'Packing scope',
        qty: 1,
        cubicFeet: 0,
        weightLbs: 0,
        included: true,
        source: 'customer_verification',
        notes: 'Captured from customer SMS.',
    }));
}
function mergeInventory(existing, incoming) {
    if (!incoming.length)
        return existing || [];
    const seen = new Set((existing || []).map(item => String(item.name || item.item || '').toLowerCase().trim()).filter(Boolean));
    const merged = [...(existing || [])];
    for (const item of incoming) {
        const key = String(item.name || item.item || '').toLowerCase().trim();
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        merged.push(item);
    }
    return merged;
}
function resolveInboundSalesContext(lead, inboundMessage) {
    const message = cleanLine(inboundMessage);
    if (!message)
        return lead;
    let route = extractRouteAddresses(message);
    if (!route.originAddress && !route.destAddress) {
        const singleAddress = firstCompleteAddress(message);
        if (singleAddress) {
            if (lead.originAddress && !(0, sales_automation_qualification_1.hasCompleteMoveAddress)(lead.originAddress))
                route = { originAddress: singleAddress };
            else if (lead.destAddress && !(0, sales_automation_qualification_1.hasCompleteMoveAddress)(lead.destAddress))
                route = { destAddress: singleAddress };
        }
    }
    const parsedInventory = extractCustomerInventoryItems(message);
    const nextInventory = mergeInventory(lead.inventory, parsedInventory);
    const inventoryMetrics = parsedInventory.length ? (0, sales_1.deriveInventoryMetrics)(nextInventory) : null;
    return {
        ...lead,
        ...(route.originAddress ? { originAddress: route.originAddress } : {}),
        ...(route.destAddress ? { destAddress: route.destAddress } : {}),
        ...(parsedInventory.length ? {
            inventory: inventoryMetrics.inventory,
            totalItems: inventoryMetrics.totalItems,
            totalCubicFeet: lead.totalCubicFeet || inventoryMetrics.totalCubicFeet,
            totalWeightLbs: lead.totalWeightLbs || inventoryMetrics.totalWeightLbs,
            roomBreakdown: {
                ...(lead.roomBreakdown || {}),
                'Packing scope': inventoryMetrics.inventory.filter(item => item.room === 'Packing scope' && item.included !== false).length,
            },
            notes: [
                lead.notes,
                `Automation capture: Customer listed packing/moving items by SMS: ${parsedInventory.map(item => item.name || item.item).join(', ')}`,
            ].filter(Boolean).join('\n\n'),
        } : {}),
    };
}
