"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMmsUrlsFromBody = extractMmsUrlsFromBody;
exports.stripMmsMarkersFromBody = stripMmsMarkersFromBody;
exports.isTwilioApiMediaUrl = isTwilioApiMediaUrl;
exports.normalizeSmsMediaUrls = normalizeSmsMediaUrls;
const MMS_MARKER_PATTERN = /\n?\[MMS:\s*([^\]]+)\]/ig;
function cleanUrl(value) {
    return value.trim().replace(/[),.;]+$/g, '');
}
function extractMmsUrlsFromBody(body) {
    if (!body)
        return [];
    const urls = [];
    MMS_MARKER_PATTERN.lastIndex = 0;
    let match = MMS_MARKER_PATTERN.exec(body);
    while (match) {
        const raw = match[1] || '';
        for (const part of raw.split(',')) {
            const url = cleanUrl(part);
            if (url)
                urls.push(url);
        }
        match = MMS_MARKER_PATTERN.exec(body);
    }
    return urls;
}
function stripMmsMarkersFromBody(body) {
    return (body || '').replace(MMS_MARKER_PATTERN, '').trim();
}
function isTwilioApiMediaUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' &&
            parsed.hostname === 'api.twilio.com' &&
            parsed.pathname.startsWith('/2010-04-01/Accounts/') &&
            parsed.pathname.includes('/Media/');
    }
    catch {
        return false;
    }
}
function normalizeSmsMediaUrls(input) {
    const urls = new Set();
    const add = (value) => {
        const url = cleanUrl(value || '');
        if (url)
            urls.add(url);
    };
    for (const item of input.media || [])
        add(item?.url);
    for (const item of input.metadata?.media || [])
        add(item?.url);
    for (const url of input.mediaUrls || [])
        add(url);
    for (const url of input.metadata?.mediaUrls || [])
        add(url);
    for (const url of input.metadata?.media_urls || [])
        add(url);
    for (const url of extractMmsUrlsFromBody(input.body))
        add(url);
    return Array.from(urls);
}
