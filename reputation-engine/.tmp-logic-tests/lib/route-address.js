"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferAddressCountryContext = inferAddressCountryContext;
exports.qualifyMoveAddress = qualifyMoveAddress;
const CANADIAN_CONTEXT_RE = /\b(?:canada|ontario|quebec|québec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland(?: and labrador)?|prince edward island|yukon|northwest territories|nunavut|on|qc|bc|ab|mb|sk|ns|nb|nl|pe|yt|nt|nu)\b/i;
const US_CONTEXT_RE = /\b(?:united states(?: of america)?|usa|u\.s\.a\.|us|u\.s\.|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|mi|ny|oh|pa|in|il|wi|mn)\b/i;
function inferAddressCountryContext(value) {
    const text = (value || '').trim();
    if (!text)
        return undefined;
    if (US_CONTEXT_RE.test(text))
        return 'us';
    if (CANADIAN_CONTEXT_RE.test(text))
        return 'ca';
    return undefined;
}
function qualifyMoveAddress(address, city) {
    const addr = (address || '').trim();
    const cityText = (city || '').trim();
    if (!addr && !cityText)
        return '';
    const hasCity = cityText.length >= 3 && addr.toLowerCase().includes(cityText.toLowerCase());
    const parts = [addr];
    if (cityText && !hasCity)
        parts.push(cityText);
    const combined = parts.filter(Boolean).join(', ');
    if (!inferAddressCountryContext(combined))
        parts.push('Ontario', 'Canada');
    return parts.filter(Boolean).join(', ');
}
