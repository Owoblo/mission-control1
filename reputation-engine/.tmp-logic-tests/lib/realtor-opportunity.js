"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYNTHETIC_REALTOR_LEAD_PREFIX = void 0;
exports.isSyntheticOpportunityLeadName = isSyntheticOpportunityLeadName;
exports.isPersonalEmailDomain = isPersonalEmailDomain;
exports.getListingSideContactRoleLabel = getListingSideContactRoleLabel;
exports.getListingSideContactDisplayName = getListingSideContactDisplayName;
exports.getListingSideContactFirstName = getListingSideContactFirstName;
exports.canAutoApplyRealtorContact = canAutoApplyRealtorContact;
exports.buildDestinationOpportunityPitch = buildDestinationOpportunityPitch;
exports.applyRealtorContactToOpportunityLead = applyRealtorContactToOpportunityLead;
exports.SYNTHETIC_REALTOR_LEAD_PREFIX = 'Realtor lead —';
const PERSONAL_EMAIL_DOMAINS = new Set([
    'gmail.com',
    'googlemail.com',
    'icloud.com',
    'me.com',
    'mac.com',
    'hotmail.com',
    'outlook.com',
    'live.com',
    'msn.com',
    'yahoo.com',
    'ymail.com',
    'aol.com',
    'proton.me',
    'protonmail.com',
]);
function isSyntheticOpportunityLeadName(name) {
    return (name || '').startsWith(exports.SYNTHETIC_REALTOR_LEAD_PREFIX);
}
function isPersonalEmailDomain(email) {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized.includes('@'))
        return false;
    const domain = normalized.split('@')[1] || '';
    return PERSONAL_EMAIL_DOMAINS.has(domain);
}
function getListingSideContactRoleLabel(contactKind) {
    if (contactKind === 'listing_agent')
        return 'Listing agent';
    if (contactKind === 'sales_representative')
        return 'Sales representative';
    if (contactKind === 'brokerage_office')
        return 'Brokerage office';
    return 'Listing-side contact';
}
function getListingSideContactDisplayName(lead) {
    const realtorName = (lead.realtorName || '').trim();
    if (realtorName)
        return realtorName;
    const brokerage = (lead.realtorBrokerage || '').trim();
    if (brokerage)
        return brokerage;
    const fallbackName = (lead.name || '').trim();
    if (fallbackName && !isSyntheticOpportunityLeadName(fallbackName))
        return fallbackName;
    return `${getListingSideContactRoleLabel(lead.realtorContactKind)} pending`;
}
function getListingSideContactFirstName(lead) {
    const realtorName = (lead.realtorName || '').trim();
    if (!realtorName)
        return 'there';
    return realtorName.split(/\s+/)[0] || 'there';
}
function digitsOnly(value) {
    return (value || '').replace(/\D/g, '');
}
function normalizeLookupText(value) {
    return (value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function normalizeBrokerageKey(value) {
    return normalizeLookupText(value)
        .replace(/\b(realty|brokerage|real estate|inc|ltd|limited|corp|corporation)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function canAutoApplyRealtorContact(input) {
    const confidence = (input.confidence || '').trim().toLowerCase();
    const contactKind = (input.contactKind || 'unknown').trim().toLowerCase();
    const email = (input.realtorEmail || '').trim().toLowerCase();
    const rawText = input.rawText || '';
    const rawTextKey = normalizeLookupText(rawText);
    const rawDigits = digitsOnly(rawText);
    const nameKey = normalizeLookupText(input.realtorName);
    const phoneDigits = digitsOnly(input.realtorPhone);
    const emailVisible = email ? rawText.toLowerCase().includes(email) : false;
    const expectedBrokerage = normalizeBrokerageKey(input.expectedBrokerage);
    const returnedBrokerage = normalizeBrokerageKey(input.realtorBrokerage);
    const brokerageVisible = (!!expectedBrokerage && rawTextKey.includes(expectedBrokerage)) ||
        (!!returnedBrokerage && rawTextKey.includes(returnedBrokerage));
    if (confidence !== 'high')
        return false;
    if (!contactKind || contactKind === 'unknown')
        return false;
    if (!nameKey || !rawTextKey.includes(nameKey))
        return false;
    if (!email || isPersonalEmailDomain(email) || !emailVisible)
        return false;
    if (!brokerageVisible && !(phoneDigits && rawDigits.includes(phoneDigits)))
        return false;
    return true;
}
function formatOpportunityMoveDate(value) {
    if (!value)
        return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return value;
    return parsed.toLocaleDateString('en-CA', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}
function buildOpportunityAddressLine(lead) {
    return lead.opportunityAddress || lead.originAddress || lead.destAddress || lead.destCity || 'the address';
}
function buildOpportunityAddressSubject(lead) {
    return buildOpportunityAddressLine(lead).split(',')[0]?.trim() || 'your listing';
}
function buildRealtorFirstName(lead) {
    return getListingSideContactFirstName(lead);
}
function buildDestinationOpportunityPitch(lead, channel) {
    const firstName = buildRealtorFirstName(lead);
    const address = buildOpportunityAddressLine(lead);
    const formattedMoveDate = formatOpportunityMoveDate(lead.sourceLeadMoveDate || lead.moveDate);
    const dateClause = formattedMoveDate
        ? ` on ${formattedMoveDate}`
        : ' soon';
    if (channel === 'sms') {
        return `Hi ${firstName}, this is Saturn Star Moving. We may be coordinating a move into ${address}${dateClause}. If your client at that address also needs movers, we may be able to offer a preferred paired-move rate since our trucks would already be servicing that stop. Happy to quote quickly by SMS or email.`;
    }
    return {
        subject: `Possible move opportunity for your client at ${buildOpportunityAddressSubject(lead)}`,
        body: `Hi ${firstName},\n\n` +
            `This is Saturn Star Moving. We may be coordinating a move into ${address}${dateClause}.\n\n` +
            `If your client at that address also needs movers, we may be able to offer a preferred paired-move rate since our trucks would already be servicing that location. That can help us move quickly and keep the process simple for both sides.\n\n` +
            `If helpful, feel free to reply here or share our details with your client and we can provide a quote promptly.\n\n` +
            `Regards,\n` +
            `John\n` +
            `Saturn Star Moving`
    };
}
function applyRealtorContactToOpportunityLead(lead, contact) {
    return { ...lead, ...contact };
}
