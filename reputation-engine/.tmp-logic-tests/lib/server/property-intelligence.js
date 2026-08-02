"use strict";
/**
 * Property Intelligence — uses Google Places + Geocoding + address parsing
 * to automatically determine access context for a moving job.
 *
 * This is advisory: every field can be overridden by the rep.
 * Confidence levels: 'high' (Google confirmed) | 'medium' (strong signal) | 'low' (inferred)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzePropertyAccess = analyzePropertyAccess;
exports.propertyAccessToJobFactors = propertyAccessToJobFactors;
const runtime_1 = require("./runtime");
// ── Unit number extraction ────────────────────────────────────────────────────
function extractUnitInfo(address) {
    const raw = address.trim();
    // Canadian prefix format: "601-203 Catherine St" — unit is before the dash
    const canadianPrefixMatch = raw.match(/^([a-z]?\d+[a-z]?)-(?=\d)/i);
    if (canadianPrefixMatch?.[1]) {
        const token = canadianPrefixMatch[1];
        const num = parseInt(token.replace(/\D/g, ''), 10);
        const unitFloor = !isNaN(num) && token.length >= 3 ? Math.floor(num / 100) : null;
        return { unitNumber: token, unitFloor: unitFloor && unitFloor > 0 ? unitFloor : null };
    }
    // Match patterns: "Unit 4", "#802", "Apt 3B", "Suite 200", "Ph", "PH1"
    const patterns = [
        /\b(?:unit|apt|apartment|suite|ste|#)\s*([a-z]?\d+[a-z]?)\b/i,
        /\b(?:ph|penthouse)\s*(\d*)\b/i,
    ];
    for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (match) {
            const token = match[1]?.trim() || '';
            const num = parseInt(token.replace(/\D/g, ''), 10);
            // Floor heuristic: unit 801 → floor 8, unit 12 → floor 1, unit 4 → floor 1
            const unitFloor = !isNaN(num) && token.length >= 3 ? Math.floor(num / 100) : null;
            return { unitNumber: match[0].trim(), unitFloor: unitFloor && unitFloor > 0 ? unitFloor : null };
        }
    }
    return { unitNumber: null, unitFloor: null };
}
// ── Google Place Detail types that indicate building type ─────────────────────
const HIGHRISE_KEYWORDS = [
    'tower', 'towers', 'plaza', 'centre', 'center', 'heights', 'terrace',
    'place', 'gardens', 'court', 'park', 'estates', 'residences', 'suites',
    'lofts', 'apartments', 'flats', 'manor', 'house apartments',
];
const TOWNHOUSE_KEYWORDS = [
    'townhouse', 'town house', 'row house', 'townhome', 'townhomes',
    'mews', 'lane', 'cluster',
];
function classifyFromGoogleTypes(types, placeName, formattedAddress, unitInfo) {
    const notes = [];
    const nameLower = (placeName || '').toLowerCase();
    const addrLower = formattedAddress.toLowerCase();
    if (types.includes('apartment_building') || types.includes('apartment_complex')) {
        notes.push('Google Places classifies this address as an apartment property');
        return { propertyType: 'apartment', confidence: 'high', notes };
    }
    if (types.includes('condominium_complex') || types.includes('housing_complex')) {
        const highrise = unitInfo.unitFloor !== null && unitInfo.unitFloor >= 5;
        notes.push('Google Places classifies this address as a condominium/housing complex');
        return { propertyType: highrise ? 'condo_highrise' : 'condo_lowrise', confidence: 'high', notes };
    }
    // Google occasionally returns explicit residential types
    if (types.includes('premise') && !unitInfo.unitNumber) {
        // No unit number + premise type → detached or semi-detached house
        notes.push('No unit number detected — treating as detached/semi house');
        return { propertyType: 'house_detached', confidence: 'low', notes };
    }
    // Subpremise = unit within a building
    if (types.includes('subpremise') || unitInfo.unitNumber) {
        // Check if it reads like a townhouse
        const isTownhouse = TOWNHOUSE_KEYWORDS.some(kw => nameLower.includes(kw) || addrLower.includes(kw));
        if (isTownhouse) {
            notes.push(`Townhouse complex detected from address context`);
            return { propertyType: 'townhouse', confidence: 'medium', notes };
        }
        // High-rise building name keywords
        const isHighrise = HIGHRISE_KEYWORDS.some(kw => nameLower.includes(kw));
        if (isHighrise || (unitInfo.unitFloor !== null && unitInfo.unitFloor >= 5)) {
            notes.push(`High-rise building inferred from ${isHighrise ? 'building name' : 'unit floor'}`);
            return { propertyType: 'condo_highrise', confidence: isHighrise ? 'high' : 'medium', notes };
        }
        // Low-rise condo/apartment
        notes.push('Unit number present — treating as low-rise condo or apartment');
        return { propertyType: 'condo_lowrise', confidence: 'medium', notes };
    }
    // No unit, no subpremise — likely a house
    notes.push('Street address without unit — treating as house');
    return { propertyType: 'house_detached', confidence: 'low', notes };
}
// ── Derive access context from property type ──────────────────────────────────
function deriveAccessFromPropertyType(propertyType, unitFloor, buildingFloors) {
    switch (propertyType) {
        case 'house_detached':
        case 'house_semi':
            return {
                estimatedFloors: buildingFloors ?? 1,
                unitFloor: 1,
                hasElevator: false,
                elevatorReservationLikely: false,
                parkingType: 'driveway',
                carryDistanceEstimate: 'short',
                stairsEstimate: buildingFloors ? Math.max(0, buildingFloors - 1) : 0,
            };
        case 'townhouse':
            return {
                estimatedFloors: buildingFloors ?? 3,
                unitFloor: 1,
                hasElevator: false,
                elevatorReservationLikely: false,
                parkingType: 'driveway',
                carryDistanceEstimate: 'short',
                stairsEstimate: buildingFloors ? buildingFloors - 1 : 0,
            };
        case 'condo_lowrise': {
            return {
                estimatedFloors: buildingFloors ?? 4,
                unitFloor,
                hasElevator: null,
                elevatorReservationLikely: true,
                parkingType: 'unknown',
                carryDistanceEstimate: 'unknown',
                stairsEstimate: 0,
            };
        }
        case 'condo_highrise': {
            return {
                estimatedFloors: buildingFloors ?? 15,
                unitFloor,
                hasElevator: null,
                elevatorReservationLikely: true,
                parkingType: 'unknown',
                carryDistanceEstimate: 'unknown',
                stairsEstimate: 0,
            };
        }
        case 'apartment': {
            return {
                estimatedFloors: buildingFloors ?? 8,
                unitFloor,
                hasElevator: null,
                elevatorReservationLikely: true,
                parkingType: 'unknown',
                carryDistanceEstimate: 'unknown',
                stairsEstimate: 0,
            };
        }
        default:
            return {
                estimatedFloors: 2,
                unitFloor: null,
                hasElevator: null,
                elevatorReservationLikely: false,
                parkingType: 'unknown',
                carryDistanceEstimate: 'unknown',
                stairsEstimate: 0,
            };
    }
}
function propertyTypeLabel(type) {
    const labels = {
        house_detached: 'Detached House',
        house_semi: 'Semi-Detached House',
        townhouse: 'Townhouse',
        condo_lowrise: 'Low-Rise Condo / Apartment',
        condo_highrise: 'High-Rise Condo / Apartment',
        apartment: 'Apartment Building',
        commercial: 'Commercial Building',
        unknown: 'Unknown',
    };
    return labels[type] ?? 'Unknown';
}
// ── Main export ───────────────────────────────────────────────────────────────
async function analyzePropertyAccess(address) {
    const apiKey = (0, runtime_1.getGoogleMapsApiKey)();
    const unitInfo = extractUnitInfo(address);
    const sources = [];
    const notes = [];
    // Default fallback
    const fallback = {
        propertyType: 'unknown',
        propertyTypeLabel: 'Unknown',
        estimatedFloors: 2,
        unitFloor: unitInfo.unitFloor,
        hasElevator: null,
        elevatorReservationLikely: false,
        parkingType: 'unknown',
        carryDistanceEstimate: 'unknown',
        stairsEstimate: 0,
        notes: ['Could not analyze address — please fill in access details manually'],
        confidence: 'low',
        source: [],
        rawAddress: address,
    };
    if (!apiKey)
        return fallback;
    try {
        // Step 1: Geocode to get place_id and types
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json` +
            `?address=${encodeURIComponent(address)}` +
            `&components=country:CA|country:US` +
            `&key=${apiKey}`;
        const geoRes = await fetch(geocodeUrl, { cache: 'no-store' });
        if (!geoRes.ok)
            return fallback;
        const geoData = (await geoRes.json());
        if (geoData.status !== 'OK' || !geoData.results?.length)
            return fallback;
        const result = geoData.results[0];
        sources.push('Google Geocoding');
        // Extract address components
        const subpremise = result.address_components.find(c => c.types.includes('subpremise'));
        const floors = result.address_components.find(c => c.types.includes('floor'));
        const hasSubpremise = !!subpremise || !!unitInfo.unitNumber;
        const detectedFloor = floors ? parseInt(floors.long_name, 10) : unitInfo.unitFloor;
        // Step 2: Get Place Details for the place (building name, types, etc.)
        const placeUrl = `https://maps.googleapis.com/maps/api/place/details/json` +
            `?place_id=${encodeURIComponent(result.place_id)}` +
            `&fields=name,types,vicinity` +
            `&key=${apiKey}`;
        let placeName = '';
        let placeTypes = result.types;
        try {
            const placeRes = await fetch(placeUrl, { cache: 'no-store' });
            if (placeRes.ok) {
                const placeData = (await placeRes.json());
                if (placeData.status === 'OK' && placeData.result) {
                    placeName = placeData.result.name || '';
                    const combined = [...placeTypes, ...(placeData.result.types || [])];
                    placeTypes = combined.filter((v, i, arr) => arr.indexOf(v) === i);
                    sources.push('Google Place Details');
                }
            }
        }
        catch { /* non-fatal */ }
        // Step 3: Classify
        const { propertyType, confidence, notes: classNotes } = classifyFromGoogleTypes(placeTypes, placeName, result.formatted_address, { ...unitInfo, unitFloor: detectedFloor });
        notes.push(...classNotes);
        // Add contextual notes
        if (hasSubpremise && subpremise)
            notes.push(`Unit detected: ${subpremise.long_name}`);
        if (detectedFloor && detectedFloor > 0)
            notes.push(`Estimated floor: ${detectedFloor}`);
        if (placeName && placeName !== result.formatted_address)
            notes.push(`Building: ${placeName}`);
        // Step 4: Derive access context
        const access = deriveAccessFromPropertyType(propertyType, detectedFloor, undefined);
        // Access notes for rep
        const accessNotes = [...notes];
        if (access.hasElevator === true)
            accessNotes.push('Elevator reported — confirm booking required');
        if (access.elevatorReservationLikely)
            accessNotes.push('Confirm elevator reservation or the building loading/back entrance');
        if (access.stairsEstimate > 0)
            accessNotes.push(`~${access.stairsEstimate} flight${access.stairsEstimate > 1 ? 's' : ''} of stairs estimated`);
        if (access.parkingType === 'driveway')
            accessNotes.push('Standard residential driveway assumed — choose 1-car or 2-car only if truck placement matters');
        if (access.parkingType === 'street')
            accessNotes.push('Street parking — factor longer carry distance');
        if (access.parkingType === 'underground')
            accessNotes.push('Underground parking possible — confirm truck height clearance');
        return {
            propertyType,
            propertyTypeLabel: propertyTypeLabel(propertyType),
            ...access,
            unitFloor: detectedFloor ?? access.unitFloor,
            notes: accessNotes,
            confidence,
            source: sources,
            rawAddress: result.formatted_address,
            placeId: result.place_id,
        };
    }
    catch {
        return fallback;
    }
}
/** Convert PropertyAccess into JobFactors fields for auto-population */
function propertyAccessToJobFactors(access, side) {
    const prefix = side === 'origin' ? 'origin' : 'dest';
    return {
        [`${prefix}Floors`]: access.unitFloor ?? undefined,
        [`${prefix}HasElevator`]: access.hasElevator ?? undefined,
        [`${prefix}ElevatorReserved`]: access.hasElevator === true ? false : undefined,
        [`${prefix}ParkingOk`]: access.parkingType === 'unknown'
            ? undefined
            : access.parkingType === 'driveway',
    };
}
