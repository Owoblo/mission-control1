"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSanitizedSubcontractorScope = buildSanitizedSubcontractorScope;
function cityOnly(value) {
    return String(value || '').split(',')[0].trim();
}
function safeAccess(value) {
    return String(value || '')
        .replace(/\b\d{1,6}\s+[A-Za-z0-9.' -]+(?:street|st|road|rd|avenue|ave|drive|dr|boulevard|blvd|lane|ln|court|ct)\b/gi, 'address withheld')
        .replace(/\b(?:unit|suite|apt|apartment)\s*#?\s*[A-Za-z0-9-]+\b/gi, 'unit withheld')
        .trim();
}
function buildSanitizedSubcontractorScope(lead, quote) {
    const estimated = Number(quote?.estimatedHours || lead.crewHours?.[0]?.hours || 0);
    const minHours = Number(quote?.minimumBillableHours || (estimated ? Math.max(1, estimated - 1) : 0));
    const maxHours = Number(quote?.maximumEstimatedHours || (estimated ? estimated + 1.5 : 0));
    return {
        lead_id: lead.id,
        quote_id: quote?.id || null,
        branch: lead.branch || null,
        move_date: lead.moveDate || quote?.moveDate || null,
        origin_city: cityOnly(lead.originCity) || 'Origin area',
        destination_city: cityOnly(lead.destCity) || 'Destination area',
        distance_km: Number(quote?.longDistanceDistanceKm ||
            quote?.legs?.reduce((sum, leg) => sum + Number(leg.operationalDistanceKm || leg.distanceKm || 0), 0) ||
            0) || null,
        estimated_hours_min: minHours || null,
        estimated_hours_max: maxHours || null,
        suggested_truck: lead.truckSize || (quote?.truckCount ? `${quote.truckCount} × 26ft truck` : null),
        crew_size: Number(quote?.crewSize || 0) || null,
        inventory: (lead.inventory || [])
            .filter(item => item.included !== false)
            .map(item => ({ name: item.name || item.item || 'Item', qty: Math.max(1, Number(item.qty || 1)), room: item.room || undefined })),
        access_summary: {
            origin: safeAccess(lead.originAccess),
            destination: safeAccess(lead.destAccess),
            parking: safeAccess(lead.parkingNotes),
        },
    };
}
