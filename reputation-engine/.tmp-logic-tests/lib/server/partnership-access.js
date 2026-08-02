"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canSeeAllPartnershipMarkets = canSeeAllPartnershipMarkets;
exports.isPartnershipManager = isPartnershipManager;
exports.partnershipMarketKeysForSession = partnershipMarketKeysForSession;
exports.partnershipScopeFilter = partnershipScopeFilter;
exports.partnershipScopeOrClause = partnershipScopeOrClause;
exports.partnershipRecordMatchesSession = partnershipRecordMatchesSession;
const partnership_lines_1 = require("../partnership-lines");
function canSeeAllPartnershipMarkets(session) {
    // A branch-scoped manager owns a market, not the entire partnership database.
    // Owners and unscoped central managers retain company-wide visibility.
    return session?.role === 'owner' || (session?.role === 'manager' && !session?.branch);
}
function isPartnershipManager(session) {
    return session?.role === 'partnership_manager' || (session?.role === 'manager' && Boolean(session?.branch));
}
function partnershipMarketKeysForSession(session) {
    if (canSeeAllPartnershipMarkets(session))
        return [];
    if (!isPartnershipManager(session))
        return [];
    const branch = session?.branch || '';
    if (!branch)
        return [];
    const keys = new Set();
    for (const line of (0, partnership_lines_1.getPartnershipLinesForMarket)(branch)) {
        keys.add((0, partnership_lines_1.normalizePartnershipCityKey)(line.market));
        for (const cityKey of line.cityKeys)
            keys.add((0, partnership_lines_1.normalizePartnershipCityKey)(cityKey));
    }
    return Array.from(keys).filter(Boolean);
}
function partnershipScopeFilter(session, columns = ['city'], includeAssigned = false) {
    const clause = partnershipScopeOrClause(session, columns, includeAssigned);
    return clause ? `&or=(${clause})` : '';
}
function partnershipScopeOrClause(session, columns = ['city'], includeAssigned = false) {
    if (canSeeAllPartnershipMarkets(session))
        return '';
    if (!isPartnershipManager(session))
        return '';
    const keys = partnershipMarketKeysForSession(session);
    const ownerClauses = includeAssigned ? [
        session?.userId ? `assigned_manager_user_id.eq.${encodeURIComponent(session.userId)}` : '',
        session?.name ? `owner_name.ilike.*${encodeURIComponent(session.name)}*` : '',
    ].filter(Boolean) : [];
    if (keys.length === 0)
        return ownerClauses.join(',') || 'id.eq.__no_partnership_market__';
    const clauses = keys.flatMap(key => columns.map(column => `${column}.ilike.*${encodeURIComponent(key)}*`));
    return [...clauses, ...ownerClauses].join(',');
}
function partnershipRecordMatchesSession(session, record, fields = ['city']) {
    if (canSeeAllPartnershipMarkets(session))
        return true;
    if (!isPartnershipManager(session))
        return false;
    if (session?.userId && String(record?.assigned_manager_user_id || '') === session.userId)
        return true;
    if (session?.name && String(record?.owner_name || '').toLowerCase().includes(session.name.toLowerCase()))
        return true;
    const keys = partnershipMarketKeysForSession(session);
    if (keys.length === 0)
        return false;
    const haystack = fields
        .map(field => (0, partnership_lines_1.normalizePartnershipCityKey)(String(record?.[field] || '')))
        .filter(Boolean)
        .join(' ');
    if (!haystack)
        return false;
    return keys.some(key => haystack.includes(key) || key.includes(haystack));
}
