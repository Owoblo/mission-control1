"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyRouteCategory = classifyRouteCategory;
exports.resolveRouteBranchForEstimate = resolveRouteBranchForEstimate;
exports.normalizeDrivingRoute = normalizeDrivingRoute;
exports.geocodeByPlaceId = geocodeByPlaceId;
exports.geocodeAddress = geocodeAddress;
exports.suggestAddresses = suggestAddresses;
exports.getDrivingRoute = getDrivingRoute;
exports.estimateRouteContext = estimateRouteContext;
const runtime_1 = require("./runtime");
const BRANCH_YARDS = {
    windsor: 'Windsor, ON, Canada',
    waterloo: 'Kitchener, ON, Canada',
    london: 'London, ON, Canada',
    ottawa: 'Ottawa, ON, Canada',
};
// Hardcoded yard coordinates — never fails, no geocoding needed for known branches
const BRANCH_YARD_COORDS = {
    windsor: { lat: 42.3149, lng: -83.0364, displayName: 'Windsor, ON (Saturn Star base)' },
    waterloo: { lat: 43.4516, lng: -80.4925, displayName: 'Kitchener, ON (Saturn Star base)' },
    london: { lat: 42.9849, lng: -81.2453, displayName: 'London, ON (Saturn Star base)' },
    ottawa: { lat: 45.4215, lng: -75.6972, displayName: 'Ottawa, ON (Saturn Star base)' },
};
const BASE_YARD_ADDRESS = BRANCH_YARDS.windsor;
const ROUTE_BRANCH_ALIASES = {
    waterloo: [
        'waterloo',
        'kitchener',
        'cambridge',
        'guelph',
        'elmira',
        'st jacobs',
        'st. jacobs',
        'baden',
        'preston',
        'hespeler',
        'doon',
        'kw',
        'k w',
    ],
    london: ['london', 'st thomas', 'st. thomas', 'woodstock', 'stratford', 'ingersoll', 'tillsonburg'],
    ottawa: ['ottawa', 'kanata', 'orleans', 'nepean', 'barrhaven', 'gatineau', 'gloucester', 'stittsville'],
    windsor: ['windsor', 'tecumseh', 'lasalle', 'la salle', 'amherstburg', 'lakeshore', 'essex', 'leamington', 'kingsville'],
};
function extractAddressLocality(address) {
    if (!address)
        return undefined;
    return (address.city ||
        address.town ||
        address.village ||
        address.hamlet ||
        address.municipality ||
        address.county ||
        address.state);
}
function classifyRouteCategory(distanceKm, driveHours) {
    // Long distance: > 200km or > 2.5h — one-way U-Haul makes more sense than returning the truck
    if (driveHours >= 2.5 || distanceKm >= 200)
        return 'long-distance';
    if (driveHours >= 1.25 || distanceKm >= 80)
        return 'medium';
    return 'local';
}
function extractRouteCity(value) {
    const parts = (value || '')
        .split(',')
        .map(part => part.trim().toLowerCase())
        .filter(Boolean);
    return parts.find(part => !/^\d/.test(part) && !/^(on|ontario|canada|united states|usa)$/.test(part));
}
function normalizeRouteBranch(value) {
    return value && BRANCH_YARDS[value] ? value : undefined;
}
function normalizeRouteLocationText(value) {
    return (value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function resolveRouteBranchForEstimate(input) {
    const explicitBranch = normalizeRouteBranch(input.branch);
    if (explicitBranch)
        return explicitBranch;
    const haystack = normalizeRouteLocationText([
        input.origin,
        input.destination,
        input.originDisplayName,
        input.destDisplayName,
    ].filter(Boolean).join(' '));
    for (const branch of ['waterloo', 'london', 'ottawa', 'windsor']) {
        if (ROUTE_BRANCH_ALIASES[branch].some(alias => haystack.includes(normalizeRouteLocationText(alias)))) {
            return branch;
        }
    }
    return 'windsor';
}
function normalizeDrivingRoute(distanceMeters, durationSeconds) {
    const rawDistanceKm = Math.max(0, distanceMeters / 1000);
    const rawDriveHours = Math.max(0, durationSeconds / 3600);
    return {
        distanceKm: rawDistanceKm > 0 ? Math.max(1, Math.round(rawDistanceKm)) : 0,
        driveHours: rawDriveHours > 0 ? Math.max(0.25, Math.round(rawDriveHours * 4) / 4) : 0,
    };
}
// Resolve a place_id directly — most accurate, no re-geocoding needed
async function geocodeByPlaceId(placeId) {
    const apiKey = (0, runtime_1.getGoogleMapsApiKey)();
    if (!apiKey)
        return null;
    try {
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=geometry,formatted_address&key=${apiKey}`;
        const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!res.ok)
            return null;
        const data = (await res.json());
        if (data.status === 'OK' && data.result) {
            return {
                lat: data.result.geometry.location.lat,
                lng: data.result.geometry.location.lng,
                displayName: data.result.formatted_address,
            };
        }
    }
    catch { /* ignore */ }
    return null;
}
async function geocodeAddress(address) {
    // Try Google Geocoding first — more reliable for addresses from Google Places autocomplete
    const apiKey = (0, runtime_1.getGoogleMapsApiKey)();
    if (apiKey) {
        try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
            const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
            if (res.ok) {
                const data = (await res.json());
                if (data.status === 'OK' && data.results?.length) {
                    return {
                        lat: data.results[0].geometry.location.lat,
                        lng: data.results[0].geometry.location.lng,
                        displayName: data.results[0].formatted_address,
                    };
                }
            }
        }
        catch { /* fall through to Nominatim */ }
    }
    // Fallback 2: Mapbox Geocoding — better rural Canadian coverage than Nominatim
    const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;
    if (mapboxToken) {
        try {
            const mbUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${mapboxToken}&country=ca,us&limit=1`;
            const mbRes = await fetch(mbUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
            if (mbRes.ok) {
                const mbData = (await mbRes.json());
                if (mbData.features?.length) {
                    const [lng, lat] = mbData.features[0].center;
                    return { lat, lng, displayName: mbData.features[0].place_name };
                }
            }
        }
        catch { /* fall through to Nominatim */ }
    }
    // Fallback 3: Nominatim (OpenStreetMap)
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=ca,us`;
    const response = await fetch(url, {
        headers: { 'User-Agent': 'SaturnStarMissionControl/1.0 (business@starmovers.ca)' },
        cache: 'no-store',
    });
    if (!response.ok)
        return null;
    const results = (await response.json());
    if (!results.length)
        return null;
    return {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon),
        displayName: results[0].display_name,
    };
}
function detectApartmentFromText(label) {
    const lower = label.toLowerCase();
    // Canadian unit-prefix format: "601-203 Catherine St"
    if (/^[a-z]?\d+[a-z]?-\d+\s/.test(label.trim()))
        return 'apartment';
    if (/\b(apt|unit|suite|#\s*\d|floor\s+\d|fl\.\s*\d|ph\b|penthouse|condo)\b/.test(lower))
        return 'apartment';
    if (/\b(tower|towers|plaza|centre|center|heights|terrace|court|park|estates|gardens)\b/.test(lower))
        return 'apartment';
    return 'unknown';
}
async function suggestWithNominatim(query) {
    const url = `https://nominatim.openstreetmap.org/search` +
        `?q=${encodeURIComponent(query)}` +
        `&format=jsonv2&limit=5&addressdetails=1&countrycodes=ca,us`;
    const response = await fetch(url, {
        headers: { 'User-Agent': 'SaturnStarMissionControl/1.0 (business@starmovers.ca)' },
        cache: 'no-store',
    });
    if (!response.ok)
        return [];
    const results = (await response.json());
    const seen = new Set();
    return results
        .map(result => {
        const placeType = result.type === 'house' || result.type === 'residential' ? 'house'
            : result.type === 'apartments' || result.type === 'flat' ? 'apartment'
                : detectApartmentFromText(result.display_name);
        return {
            label: result.display_name,
            city: extractAddressLocality(result.address),
            placeType,
        };
    })
        .filter(r => {
        if (!r.label || seen.has(r.label))
            return false;
        seen.add(r.label);
        return true;
    });
}
async function suggestAddresses(query) {
    const trimmed = query.trim();
    if (trimmed.length < 5)
        return [];
    // Try Google Places Autocomplete when API key is available
    const apiKey = (0, runtime_1.getGoogleMapsApiKey)();
    if (apiKey) {
        try {
            const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
                `?input=${encodeURIComponent(trimmed)}` +
                `&types=address` +
                `&components=country:ca|country:us` +
                `&key=${apiKey}`;
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) {
                const data = (await res.json());
                if (data.status === 'OK' || data.status === 'ZERO_RESULTS') {
                    return (data.predictions || []).map(p => {
                        const types = p.types || [];
                        const placeType = types.includes('subpremise') ? 'apartment'
                            : types.includes('establishment') || types.includes('point_of_interest') ? 'commercial'
                                : types.includes('street_address') || types.includes('premise') ? detectApartmentFromText(p.description)
                                    : detectApartmentFromText(p.description);
                        const cityMatch = p.description.match(/,\s*([^,]+),\s*ON|,\s*([^,]+),\s*MI/);
                        return {
                            label: p.description,
                            city: cityMatch?.[1] || cityMatch?.[2] || undefined,
                            placeType,
                            placeId: p.place_id,
                        };
                    });
                }
            }
        }
        catch { /* fall through to Nominatim */ }
    }
    // Fallback: Nominatim (OpenStreetMap) — always works, no API key needed
    return suggestWithNominatim(trimmed);
}
async function getDrivingRoute(origin, dest) {
    const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;
    if (mapboxToken) {
        try {
            // Mapbox Directions API — production-grade, reliable, fast
            const coords = `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?access_token=${mapboxToken}&overview=false`;
            const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
            if (res.ok) {
                const data = (await res.json());
                if (data.code === 'Ok' && data.routes?.length) {
                    return normalizeDrivingRoute(data.routes[0].distance, data.routes[0].duration);
                }
            }
        }
        catch { /* fall through to OSRM */ }
    }
    // Fallback: OSRM (free, no key needed)
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`;
    const response = await fetch(url, {
        headers: { 'User-Agent': 'SaturnStarMissionControl/1.0 (business@starmovers.ca)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
        return null;
    const data = (await response.json());
    if (data.code !== 'Ok' || !data.routes?.length)
        return null;
    return normalizeDrivingRoute(data.routes[0].distance, data.routes[0].duration);
}
async function estimateRouteContext(input) {
    const routeBranch = resolveRouteBranchForEstimate(input);
    const yardAddress = BRANCH_YARDS[routeBranch] || BASE_YARD_ADDRESS;
    // Use hardcoded coords for known branches — no geocoding needed, never fails
    const yardGeoHardcoded = BRANCH_YARD_COORDS[routeBranch] || BRANCH_YARD_COORDS.windsor;
    // Geocode with fallback: if full address fails, try stripping the last token
    // Also handles pre-resolved "lat,lng" format passed from place_id resolution
    async function geocodeWithFallback(address) {
        // If already a lat,lng coordinate (from place_id resolution), parse directly
        const latLngMatch = address.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
        if (latLngMatch) {
            return { lat: parseFloat(latLngMatch[1]), lng: parseFloat(latLngMatch[2]), displayName: address };
        }
        const result = await geocodeAddress(address);
        if (result)
            return result;
        const parts = address.split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length > 2) {
            return geocodeAddress(parts.slice(0, -1).join(', '));
        }
        return null;
    }
    const [originGeo, destGeo] = await Promise.all([
        geocodeWithFallback(input.origin.trim()),
        input.destination?.trim() ? geocodeWithFallback(input.destination.trim()) : Promise.resolve(null),
    ]);
    // Yard: always use hardcoded branch coords for routing
    // U-Haul pickup distance is handled separately in the Live Margin — keeps pricing engine clean
    const yardGeo = yardGeoHardcoded;
    if (!originGeo) {
        throw new Error(`Could not locate: "${input.origin}"`);
    }
    const yardToOrigin = await getDrivingRoute(yardGeo, originGeo);
    if (!yardToOrigin) {
        throw new Error('Could not calculate yard to origin drive time');
    }
    if (!input.destination?.trim()) {
        return {
            pricingStatus: 'provisional',
            routeCategory: 'local',
            category: 'local',
            distanceKm: yardToOrigin.distanceKm,
            distanceMiles: Math.round(yardToOrigin.distanceKm * 0.621371),
            driveHours: yardToOrigin.driveHours,
            yardToOriginHours: yardToOrigin.driveHours,
            billableDistanceKm: yardToOrigin.distanceKm,
            operationalDistanceKm: yardToOrigin.distanceKm,
            billableDriveHours: yardToOrigin.driveHours,
            operationalDriveHours: yardToOrigin.driveHours,
            yardToOrigin,
            originToDestination: null,
            returnToOrigin: null,
            missingRequirements: ['Destination address or city needed for travel estimate'],
            originResolved: originGeo.displayName,
            yardResolved: yardGeo.displayName,
        };
    }
    if (!destGeo) {
        throw new Error(`Could not locate: "${input.destination}"`);
    }
    const [originToDestination, returnToOrigin] = await Promise.all([
        getDrivingRoute(originGeo, destGeo),
        getDrivingRoute(destGeo, yardGeo),
    ]);
    if (!originToDestination || !returnToOrigin) {
        throw new Error('Could not calculate driving route between these addresses');
    }
    const originCity = extractRouteCity(input.origin);
    const destCity = extractRouteCity(input.destination);
    if (originCity &&
        destCity &&
        originCity === destCity &&
        originToDestination.distanceKm > 120) {
        throw new Error(`Route estimate looks wrong for a local ${originCity} move. Please select the destination from autocomplete or include city/province.`);
    }
    const routeCategory = classifyRouteCategory(originToDestination.distanceKm, originToDestination.driveHours);
    const billableDistanceKm = routeCategory === 'long-distance'
        ? originToDestination.distanceKm + returnToOrigin.distanceKm
        : yardToOrigin.distanceKm + originToDestination.distanceKm + returnToOrigin.distanceKm;
    const operationalDistanceKm = yardToOrigin.distanceKm + originToDestination.distanceKm + returnToOrigin.distanceKm;
    const billableDriveHours = routeCategory === 'long-distance'
        ? originToDestination.driveHours + returnToOrigin.driveHours
        : yardToOrigin.driveHours + originToDestination.driveHours + returnToOrigin.driveHours;
    const operationalDriveHours = yardToOrigin.driveHours + originToDestination.driveHours + returnToOrigin.driveHours;
    return {
        pricingStatus: 'ready',
        routeCategory,
        category: routeCategory,
        distanceKm: originToDestination.distanceKm,
        distanceMiles: Math.round(originToDestination.distanceKm * 0.621371),
        driveHours: originToDestination.driveHours,
        yardToOriginHours: yardToOrigin.driveHours,
        originToDestinationHours: originToDestination.driveHours,
        returnTripHours: returnToOrigin.driveHours,
        originToDestinationDistanceKm: originToDestination.distanceKm,
        yardToOriginDistanceKm: yardToOrigin.distanceKm,
        returnTripDistanceKm: returnToOrigin.distanceKm,
        billableDistanceKm,
        operationalDistanceKm,
        billableDriveHours,
        operationalDriveHours,
        yardToOrigin,
        originToDestination,
        returnToOrigin,
        missingRequirements: [],
        originResolved: originGeo.displayName,
        destResolved: destGeo.displayName,
        yardResolved: yardGeo.displayName,
    };
}
