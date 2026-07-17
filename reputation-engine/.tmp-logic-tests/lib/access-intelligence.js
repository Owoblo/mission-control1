"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveAccessComplexityAssessment = deriveAccessComplexityAssessment;
const listing_1 = require("./listing");
function roundQuarterHour(hours) {
    return Math.round(hours * 4) / 4;
}
function hasKnownAccessSignals(factors) {
    if (!factors)
        return false;
    return [
        factors.originFloors,
        factors.originHasElevator,
        factors.originElevatorReserved,
        factors.originParkingOk,
        factors.destFloors,
        factors.destHasElevator,
        factors.destElevatorReserved,
        factors.destParkingOk,
        factors.personBOriginFloors,
        factors.personBOriginHasElevator,
        factors.personBOriginElevatorReserved,
        factors.personBOriginParkingOk,
    ].some(value => value !== undefined && value !== null);
}
function sideSignals(side, floors, hasElevator, elevatorReserved, parkingOk, customLabel) {
    const signals = [];
    const labelPrefix = customLabel || (side === 'origin' ? 'Origin' : side === 'destination' ? 'Destination' : 'Route');
    const normalizedFloors = Number(floors || 1);
    if (normalizedFloors >= 2 && !hasElevator) {
        const minutes = Math.round((normalizedFloors - 1) * 21);
        signals.push({
            side,
            label: `${labelPrefix}: ${normalizedFloors} floor${normalizedFloors === 1 ? '' : 's'} with stairs`,
            minutes,
            severity: minutes >= 45 ? 'high_risk' : 'review',
        });
    }
    if (hasElevator && !elevatorReserved) {
        signals.push({
            side,
            label: `${labelPrefix}: elevator likely needs reservation`,
            minutes: 45,
            severity: 'high_risk',
        });
    }
    if (parkingOk === false) {
        signals.push({
            side,
            label: `${labelPrefix}: no direct truck access`,
            minutes: 45,
            severity: 'high_risk',
        });
    }
    return signals;
}
function hasApartmentLikeContext(lead = {}, listing) {
    const type = lead.propertyType;
    if (type === 'apartment' || type === 'condo' || type === 'storage_unit' || type === 'commercial')
        return true;
    const highlights = (0, listing_1.getListingOperationalHighlights)(listing).join(' ').toLowerCase();
    const parking = (0, listing_1.getListingParkingFeatures)(listing).join(' ').toLowerCase();
    return /\b(condo|apartment|suite|unit|high[- ]?rise|elevator|underground)\b/.test(`${highlights} ${parking}`);
}
function deriveAccessComplexityAssessment(lead) {
    const factors = lead.jobFactors || {};
    const signals = [
        ...sideSignals('origin', factors.originFloors, factors.originHasElevator, factors.originElevatorReserved, factors.originParkingOk),
        ...sideSignals('destination', factors.destFloors, factors.destHasElevator, factors.destElevatorReserved, factors.destParkingOk),
        ...(factors.conjointMove
            ? sideSignals('route', factors.personBOriginFloors, factors.personBOriginHasElevator, factors.personBOriginElevatorReserved, factors.personBOriginParkingOk, 'Second pickup')
            : []),
    ];
    const knownSignals = hasKnownAccessSignals(factors);
    const apartmentContext = hasApartmentLikeContext(lead, lead.supabaseListing);
    const parkingNotes = (lead.parkingNotes || '').trim();
    const accessNotes = [lead.originAccess, lead.destAccess].filter(Boolean).join(' ').toLowerCase();
    if (!knownSignals && apartmentContext) {
        signals.push({
            side: 'route',
            label: 'Property context suggests apartment/condo access should be reviewed',
            minutes: 30,
            severity: 'review',
        });
    }
    if (parkingNotes && /\b(no parking|street|loading|dock|underground|permit|long carry|elevator|stairs)\b/i.test(parkingNotes)) {
        signals.push({
            side: 'route',
            label: 'Parking/access notes mention a possible setup constraint',
            minutes: 20,
            severity: 'review',
        });
    }
    if (accessNotes && /\b(long carry|stairs|elevator|loading|dock|basement|permit)\b/i.test(accessNotes)) {
        signals.push({
            side: 'route',
            label: 'Access notes mention a possible move-day constraint',
            minutes: 20,
            severity: 'review',
        });
    }
    const extraMinutes = signals.reduce((sum, signal) => sum + signal.minutes, 0);
    const status = !knownSignals && signals.length === 0
        ? 'unknown'
        : signals.some(signal => signal.severity === 'high_risk')
            ? 'high_risk'
            : signals.length > 0
                ? 'review'
                : 'clear';
    const label = status === 'clear'
        ? 'Access clear'
        : status === 'review'
            ? 'Access review'
            : status === 'high_risk'
                ? 'Access risk'
                : 'Access unknown';
    const summary = status === 'clear'
        ? 'House-style access detected. No extra access time expected.'
        : status === 'unknown'
            ? 'Access has not been inferred yet. Add addresses or run address intelligence.'
            : signals.map(signal => `${signal.label} (+${signal.minutes} min)`).join(' · ');
    return {
        status,
        label,
        extraMinutes,
        extraHours: roundQuarterHour(extraMinutes / 60),
        accessAutoClear: status === 'clear',
        parkingAutoClear: status === 'clear' || (knownSignals && factors.originParkingOk !== false && factors.destParkingOk !== false && factors.personBOriginParkingOk !== false),
        signals,
        summary,
    };
}
