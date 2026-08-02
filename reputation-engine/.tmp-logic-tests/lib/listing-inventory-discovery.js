"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listingInventoryScanDedupeKey = listingInventoryScanDedupeKey;
exports.listingInventoryScanInProgress = listingInventoryScanInProgress;
exports.listingInventoryFallbackAllowed = listingInventoryFallbackAllowed;
function listingInventoryScanDedupeKey(leadId, listingId) {
    return `listing_inventory_scan:${leadId}:${listingId}`;
}
function listingInventoryScanInProgress(lead) {
    const status = lead.qualificationState?.inventoryDiscovery?.status;
    return status === 'queued' || status === 'scanning';
}
function listingInventoryFallbackAllowed(lead) {
    if ((lead.inventory || []).length > 0 || Number(lead.totalCubicFeet || 0) > 0)
        return false;
    if (listingInventoryScanInProgress(lead))
        return false;
    if (lead.surveyRequestedAt || lead.surveyCompletedAt)
        return false;
    return true;
}
