"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReceiptBrand = getReceiptBrand;
const SATURN = {
    name: 'Saturn Star',
    fullName: 'Saturn Star Movers',
    tagline: 'Moving with care, from city to city.',
    phone: '226-773-2993',
    phoneHref: 'tel:+12267732993',
    email: 'info@starmovers.ca',
    website: 'starmovers.ca',
    logoPath: '/brand/saturn-star-horizontal-full-color.png',
};
const DEXA = {
    name: 'Dexa Movers',
    fullName: 'Dexa Movers',
    tagline: 'Professional moving, built around care.',
    phone: '613-519-3236',
    phoneHref: 'tel:+16135193236',
};
function looksOttawa(...values) {
    return values.some(value => /\b(ottawa|kanata|nepean|orleans|gloucester|gatineau|manotick|stittsville)\b/i.test(value || ''));
}
function getReceiptBrand(lead, quote) {
    if (lead?.branch === 'ottawa' || looksOttawa(lead?.originCity, lead?.originAddress, lead?.destCity, lead?.destAddress, quote?.originCity, quote?.originAddress, quote?.destCity, quote?.destAddress))
        return DEXA;
    return SATURN;
}
