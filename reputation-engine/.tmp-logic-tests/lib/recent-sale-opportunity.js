"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECENT_SALE_MESSAGE_TEMPLATE = void 0;
exports.digits = digits;
exports.normalizePersonName = normalizePersonName;
exports.normalizeBrokerage = normalizeBrokerage;
exports.buildRecentSaleEventKey = buildRecentSaleEventKey;
exports.scoreRecentSaleContact = scoreRecentSaleContact;
exports.classifyRecentSaleRelationship = classifyRecentSaleRelationship;
exports.buildRecentSaleMessage = buildRecentSaleMessage;
exports.buildRecentSaleListingUrl = buildRecentSaleListingUrl;
function compact(value) {
    return (value || '').trim();
}
function digits(value) {
    return compact(value).replace(/\D/g, '').slice(-10);
}
function normalizePersonName(value) {
    return compact(value)
        .toLowerCase()
        .replace(/\b(realtor|salesperson|sales person|broker|broker of record|representative)\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
function normalizeBrokerage(value) {
    return compact(value)
        .toLowerCase()
        .replace(/\b(incorporated|inc|limited|ltd|brokerage|real estate|realty)\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function buildRecentSaleEventKey(input) {
    const property = compact(input.mls) || `${compact(input.address)}|${compact(input.city)}`;
    return `${property}|${normalizePersonName(input.realtorName)}`
        .toLowerCase()
        .replace(/[^a-z0-9|]+/g, '_');
}
function scoreRecentSaleContact(representative, contact) {
    const repPhone = digits(representative.phone);
    const contactPhone = digits(contact.phone);
    const repEmail = compact(representative.email).toLowerCase();
    const contactEmail = compact(contact.email).toLowerCase();
    const repName = normalizePersonName(representative.name);
    const contactName = normalizePersonName(contact.name);
    const repBrokerage = normalizeBrokerage(representative.brokerage);
    const contactBrokerage = normalizeBrokerage(contact.company);
    const sameCity = compact(contact.city).toLowerCase() !== '' &&
        compact(contact.city).toLowerCase() === compact(representative.city).toLowerCase();
    let score = 0;
    const reasons = [];
    if (repPhone && repPhone === contactPhone) {
        score += 100;
        reasons.push('phone');
    }
    if (repEmail && repEmail === contactEmail) {
        score += 100;
        reasons.push('email');
    }
    if (repName && repName === contactName) {
        score += 55;
        reasons.push('name');
    }
    if (repBrokerage && contactBrokerage && repBrokerage === contactBrokerage) {
        score += 35;
        reasons.push('brokerage');
    }
    if (sameCity) {
        score += 10;
        reasons.push('city');
    }
    return { score, reasons };
}
function classifyRecentSaleRelationship(contact) {
    if (!contact)
        return 'unmatched';
    const stage = compact(contact.stage).toLowerCase();
    const outcome = compact(contact.partnership_outcome).toLowerCase();
    const temperature = compact(contact.relationship_temperature).toLowerCase();
    if (outcome === 'secured' ||
        ['partnership_active', 'partnered', 'referring', 'active_partner'].includes(stage))
        return 'active_partner';
    if (temperature === 'hot' || temperature === 'warm' || (contact.relationship_score || 0) >= 45)
        return 'warm';
    if (contact.last_inbound_at || !['', 'new', 'prospect', 'cold'].includes(stage))
        return 'known';
    return 'cold';
}
function firstName(value) {
    return compact(value).split(/\s+/)[0] || 'there';
}
function streetOnly(address) {
    return compact(address).split(',')[0] || 'your recent sale';
}
exports.RECENT_SALE_MESSAGE_TEMPLATE = `Hi {{name}}, congratulations on the sale of {{address}}.

I wanted to reach out in case your client still needs help with their move. We’d be happy to provide them with a straightforward estimate and make the process as easy as possible.

No pressure at all, but would you be comfortable passing along our number to them?`;
function buildRecentSaleMessage(input) {
    return exports.RECENT_SALE_MESSAGE_TEMPLATE
        .replaceAll('{{name}}', firstName(input.realtorName))
        .replaceAll('{{address}}', streetOnly(input.address));
}
function httpUrl(value) {
    if (typeof value !== 'string' || !value.trim())
        return '';
    try {
        const parsed = new URL(value.trim());
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
    }
    catch {
        return '';
    }
}
function buildRecentSaleListingUrl(input) {
    const metadata = input.metadata || {};
    const directCandidates = [
        metadata.listing_url,
        metadata.listingUrl,
        metadata.ListingURL,
        metadata.source_url,
        metadata.sourceUrl,
        metadata.realtor_url,
        metadata.realtorUrl,
        metadata.zillow_url,
        metadata.zillowUrl,
        metadata.property_url,
        metadata.propertyUrl,
        metadata.url,
        input.verificationSource,
    ];
    for (const candidate of directCandidates) {
        const url = httpUrl(candidate);
        if (url)
            return url;
    }
    const query = [`"${streetOnly(input.address)}"`, compact(input.city), 'Ontario']
        .filter(Boolean)
        .join(' ');
    return `https://www.google.com/search?q=${encodeURIComponent(`site:realtor.ca/real-estate OR site:zillow.com/homedetails ${query}`)}`;
}
