"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasStreetNumber = hasStreetNumber;
exports.hasCanadianPostalCode = hasCanadianPostalCode;
exports.hasUnitMarker = hasUnitMarker;
exports.hasStreetType = hasStreetType;
exports.hasCompleteMoveAddress = hasCompleteMoveAddress;
exports.getExactAddressMissingFields = getExactAddressMissingFields;
exports.hasCompleteRouteAddresses = hasCompleteRouteAddresses;
exports.hasVerifiedInventory = hasVerifiedInventory;
exports.hasMlsDraftInventoryNeedingConfirmation = hasMlsDraftInventoryNeedingConfirmation;
exports.hasAnyAccessDetails = hasAnyAccessDetails;
exports.addressNeedsAccessConfirmation = addressNeedsAccessConfirmation;
exports.leadNeedsAccessBeforeAutomatedQuote = leadNeedsAccessBeforeAutomatedQuote;
exports.getAutomationMissingFields = getAutomationMissingFields;
exports.buildLeadQualificationState = buildLeadQualificationState;
function hasStreetNumber(value) {
    return /\d{1,6}/.test(value || '');
}
function hasCanadianPostalCode(value) {
    return /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/i.test(value || '');
}
function hasUnitMarker(value) {
    const text = value || '';
    return (/\b(unit|suite|ste|apt|apartment|condo|#\s*[a-z0-9]|ph\b|penthouse)\b/i.test(text) ||
        /\b\d{1,5}\s*-\s*\d{1,6}\b/.test(text));
}
function hasStreetType(value) {
    return /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|cres|crescent|ct|court|ln|lane|way|pkwy|parkway|pl|place|terrace|trail|circle|cir|sq|square|hwy|highway)\b/i.test(value || '');
}
function hasCompleteMoveAddress(value) {
    const text = (value || '').replace(/\s+/g, ' ').trim();
    if (!text)
        return false;
    if (!hasStreetNumber(text))
        return false;
    return hasStreetType(text) || hasCanadianPostalCode(text);
}
function getExactAddressMissingFields(lead) {
    const missing = [];
    if (!hasCompleteMoveAddress(lead.originAddress))
        missing.push('origin_address');
    if (!hasCompleteMoveAddress(lead.destAddress))
        missing.push('destination_address');
    return missing;
}
function hasCompleteRouteAddresses(lead) {
    return getExactAddressMissingFields(lead).length === 0;
}
function hasVerifiedInventory(lead) {
    return !!lead.surveyCompletedAt || !!lead.inventoryVerification?.completedAt;
}
function hasMlsDraftInventoryNeedingConfirmation(lead) {
    const hasInventory = !!(lead.inventory || []).filter(item => item.included !== false &&
        ['mls', 'mls_photo_ai', 'existing_scan', 'fallback_scan'].includes(String(item.source || ''))).length;
    const hasListingDraft = !!lead.listingScanSnapshot || !!lead.lastAutoEnrichmentAt;
    return hasInventory && hasListingDraft && !hasVerifiedInventory(lead);
}
function hasAnyAccessDetails(lead) {
    return (!!lead.originAccess ||
        !!lead.destAccess ||
        !!lead.parkingNotes ||
        lead.jobFactors?.originFloors !== undefined ||
        lead.jobFactors?.destFloors !== undefined ||
        lead.jobFactors?.originHasElevator !== undefined ||
        lead.jobFactors?.destHasElevator !== undefined ||
        lead.jobFactors?.originParkingOk !== undefined ||
        lead.jobFactors?.destParkingOk !== undefined ||
        lead.jobFactors?.originElevatorReserved !== undefined ||
        lead.jobFactors?.destElevatorReserved !== undefined);
}
function addressNeedsAccessConfirmation(address, propertyType) {
    const text = address || '';
    if (propertyType === 'apartment' || propertyType === 'condo' || propertyType === 'commercial' || propertyType === 'storage_unit') {
        return true;
    }
    return (hasUnitMarker(text) ||
        /\b(condo|apartment|apt|suite|tower|building|high[- ]?rise|elevator|storage|commercial|office|loading dock)\b/i.test(text));
}
function leadNeedsAccessBeforeAutomatedQuote(lead) {
    if (hasAnyAccessDetails(lead))
        return false;
    return (addressNeedsAccessConfirmation(lead.originAddress, lead.propertyType) ||
        addressNeedsAccessConfirmation(lead.destAddress, lead.propertyType));
}
function getAutomationMissingFields(lead) {
    const missing = [];
    const moveDateKnown = !!lead.moveDate || !!lead.moveDateFlexible;
    const routeKnown = hasCompleteRouteAddresses(lead);
    const inventoryKnown = (!!lead.totalItems || !!lead.totalCubicFeet || !!(lead.inventory || []).length || !!lead.surveyCompletedAt) &&
        !hasMlsDraftInventoryNeedingConfirmation(lead);
    const accessKnown = hasAnyAccessDetails(lead);
    if (!lead.moveDate && !lead.moveDateFlexible)
        missing.push('move_date');
    if (!lead.originCity && !lead.originAddress)
        missing.push('origin');
    else if (!hasCompleteMoveAddress(lead.originAddress))
        missing.push('origin_address');
    if (!lead.destCity && !lead.destAddress)
        missing.push('destination');
    else if (!hasCompleteMoveAddress(lead.destAddress))
        missing.push('destination_address');
    if (hasMlsDraftInventoryNeedingConfirmation(lead))
        missing.push('inventory_confirmation');
    else if (!lead.totalItems && !lead.totalCubicFeet && !(lead.inventory || []).length && !lead.surveyCompletedAt)
        missing.push('inventory');
    if (!lead.email && moveDateKnown && routeKnown && inventoryKnown)
        missing.push('customer_email');
    if (!accessKnown)
        missing.push('access');
    return missing;
}
function buildLeadQualificationState(lead, overrides = {}) {
    const missingFields = Object.prototype.hasOwnProperty.call(overrides, 'missingFields')
        ? overrides.missingFields || []
        : getAutomationMissingFields(lead);
    return {
        moveDateKnown: !!lead.moveDate || !!lead.moveDateFlexible,
        routeKnown: hasCompleteRouteAddresses(lead),
        inventoryKnown: (!!lead.totalItems || !!lead.totalCubicFeet || !!(lead.inventory || []).length || !!lead.surveyCompletedAt) &&
            !hasMlsDraftInventoryNeedingConfirmation(lead),
        accessKnown: hasAnyAccessDetails(lead),
        surveyRequested: !!lead.surveyRequestedAt,
        surveyCompleted: !!lead.surveyCompletedAt,
        quoteReady: missingFields.length === 0 || (missingFields.length === 1 && missingFields[0] === 'access'),
        activeCustomer: lead.stage === 'booked' || lead.stage === 'completed' || lead.stage === 'customer_success',
        missingFields,
        addressVerification: Object.prototype.hasOwnProperty.call(overrides, 'addressVerification')
            ? overrides.addressVerification
            : lead.qualificationState?.addressVerification,
        nextBestAction: overrides.nextBestAction ||
            (missingFields[0] === 'move_date'
                ? 'collect_move_date'
                : missingFields[0] === 'origin' ||
                    missingFields[0] === 'destination' ||
                    missingFields[0] === 'origin_address' ||
                    missingFields[0] === 'destination_address'
                    ? 'collect_route'
                    : missingFields[0] === 'inventory'
                        ? 'collect_inventory'
                        : missingFields[0] === 'inventory_confirmation'
                            ? 'confirm_inventory'
                            : missingFields[0] === 'access'
                                ? 'collect_access'
                                : 'hand_off_for_quote'),
        lastIntent: overrides.lastIntent,
        capturedSummary: overrides.capturedSummary,
    };
}
