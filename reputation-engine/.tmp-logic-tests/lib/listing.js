"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getListingBedrooms = getListingBedrooms;
exports.getListingBathrooms = getListingBathrooms;
exports.getListingPropertyContext = getListingPropertyContext;
exports.formatListingPropertySummary = formatListingPropertySummary;
exports.getListingDescription = getListingDescription;
exports.getListingParkingFeatures = getListingParkingFeatures;
exports.getListingStreetViewMetadataUrl = getListingStreetViewMetadataUrl;
exports.getListingStreetViewUrl = getListingStreetViewUrl;
exports.getListingOperationalHighlights = getListingOperationalHighlights;
exports.formatListingContextSummary = formatListingContextSummary;
exports.hasRichListingContext = hasRichListingContext;
exports.shouldPreferListingSnapshot = shouldPreferListingSnapshot;
function coercePositiveNumber(value) {
    if (value === null || value === undefined || value === '')
        return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return undefined;
    return parsed;
}
function getListingBedrooms(listing) {
    return coercePositiveNumber(listing?.bedrooms ?? listing?.beds);
}
function getListingBathrooms(listing) {
    return coercePositiveNumber(listing?.bathrooms ?? listing?.baths);
}
function getListingPropertyContext(listing) {
    const bedrooms = getListingBedrooms(listing);
    const bathrooms = getListingBathrooms(listing);
    if (!bedrooms && !bathrooms)
        return undefined;
    return { bedrooms, bathrooms };
}
function formatCount(value, singular, plural = `${singular}s`) {
    return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)} ${value === 1 ? singular : plural}`;
}
function formatListingPropertySummary(listing) {
    const bedrooms = getListingBedrooms(listing);
    const bathrooms = getListingBathrooms(listing);
    const parts = [];
    if (bedrooms)
        parts.push(formatCount(bedrooms, 'bed'));
    if (bathrooms)
        parts.push(formatCount(bathrooms, 'bath'));
    return parts.join(' · ');
}
function normalizeOptionalText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function coerceStringArray(value) {
    if (Array.isArray(value)) {
        return value
            .map(item => normalizeOptionalText(item))
            .filter((item) => !!item);
    }
    const text = normalizeOptionalText(value);
    if (!text)
        return [];
    return text
        .split(/[,;|]+/)
        .map(item => item.trim())
        .filter(Boolean);
}
function getListingDescription(listing) {
    return normalizeOptionalText(listing?.description) || normalizeOptionalText(listing?.propertyDescription);
}
function getListingParkingFeatures(listing) {
    return coerceStringArray(listing?.parkingFeatures);
}
function getListingStreetViewMetadataUrl(listing) {
    return normalizeOptionalText(listing?.streetViewMetadataUrl);
}
function getListingStreetViewUrl(listing) {
    return normalizeOptionalText(listing?.streetViewUrl);
}
function coercePositiveWholeNumber(value) {
    const parsed = coercePositiveNumber(value);
    return parsed ? Math.round(parsed) : undefined;
}
function getListingOperationalHighlights(listing) {
    if (!listing)
        return [];
    const highlights = [];
    const parkingFeatures = getListingParkingFeatures(listing);
    const basement = normalizeOptionalText(listing.basement);
    const livingArea = coercePositiveWholeNumber(listing.livingArea);
    const lotSize = coercePositiveWholeNumber(listing.lotSize);
    const yearBuilt = coercePositiveWholeNumber(listing.yearBuilt);
    const homeStatus = normalizeOptionalText(listing.homeStatus);
    if (parkingFeatures.length > 0)
        highlights.push(parkingFeatures.join(' · '));
    if (basement)
        highlights.push(basement);
    if (livingArea)
        highlights.push(`${livingArea.toLocaleString()} sq ft`);
    if (lotSize)
        highlights.push(`${lotSize.toLocaleString()} sq ft lot`);
    if (yearBuilt)
        highlights.push(`Built ${yearBuilt}`);
    if (homeStatus)
        highlights.push(homeStatus.replace(/_/g, ' '));
    if (getListingStreetViewMetadataUrl(listing))
        highlights.push('Street View metadata available');
    return highlights;
}
function formatListingContextSummary(listing) {
    const propertySummary = formatListingPropertySummary(listing);
    if (propertySummary)
        return propertySummary;
    const highlights = getListingOperationalHighlights(listing);
    if (highlights.length > 0)
        return highlights[0];
    if (getListingDescription(listing))
        return 'Listing matched';
    if (normalizeOptionalText(listing?.address))
        return 'Listing matched';
    return '';
}
function getListingCompletenessScore(listing) {
    if (!listing)
        return 0;
    let score = 0;
    score += (listing.carouselphotos || []).length;
    if (getListingBedrooms(listing))
        score += 8;
    if (getListingBathrooms(listing))
        score += 8;
    if (getListingDescription(listing))
        score += 10;
    if (getListingParkingFeatures(listing).length > 0)
        score += 8;
    if (normalizeOptionalText(listing.basement))
        score += 4;
    if (coercePositiveNumber(listing.livingArea))
        score += 4;
    if (coercePositiveNumber(listing.yearBuilt))
        score += 2;
    if (getListingStreetViewMetadataUrl(listing))
        score += 4;
    return score;
}
function hasRichListingContext(listing) {
    if (!listing)
        return false;
    return Boolean(getListingBedrooms(listing) ||
        getListingBathrooms(listing) ||
        getListingDescription(listing) ||
        getListingParkingFeatures(listing).length > 0 ||
        normalizeOptionalText(listing.basement) ||
        coercePositiveNumber(listing.livingArea) ||
        coercePositiveNumber(listing.yearBuilt) ||
        getListingStreetViewMetadataUrl(listing));
}
function shouldPreferListingSnapshot(current, candidate) {
    if (!candidate)
        return false;
    if (!current)
        return true;
    return getListingCompletenessScore(candidate) > getListingCompletenessScore(current);
}
