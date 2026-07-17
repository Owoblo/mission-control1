"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readEnv = readEnv;
exports.requireEnv = requireEnv;
exports.getAppBaseUrl = getAppBaseUrl;
exports.getWorkerSharedSecret = getWorkerSharedSecret;
exports.requireSupabaseEnv = requireSupabaseEnv;
exports.requireWorkerBaseUrl = requireWorkerBaseUrl;
exports.getTwilioCredentials = getTwilioCredentials;
exports.getInstantlyApiKey = getInstantlyApiKey;
exports.getGoogleMapsApiKey = getGoogleMapsApiKey;
function normalizeEnvValue(value) {
    const trimmed = (value || '').trim();
    if (!trimmed)
        return '';
    const unquoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
        ? trimmed.slice(1, -1)
        : trimmed;
    return unquoted
        .replace(/\\r/g, '')
        .replace(/\\n/g, '')
        .replace(/\r/g, '')
        .replace(/\n/g, '')
        .trim();
}
function readEnv(name) {
    return normalizeEnvValue(process.env[name]);
}
function requireEnv(name, message = `Missing ${name}`) {
    const value = readEnv(name);
    if (!value) {
        throw new Error(message);
    }
    return value;
}
function getAppBaseUrl(fallback = '') {
    const normalizedFallback = fallback.trim();
    const url = readEnv('NEXT_PUBLIC_APP_URL') || normalizedFallback;
    return url.replace(/\/$/, '');
}
function getWorkerSharedSecret() {
    return readEnv('WORKER_SHARED_SECRET');
}
function requireSupabaseEnv() {
    const url = requireEnv('SUPABASE_URL', 'Missing SUPABASE_URL or SUPABASE_KEY');
    const key = requireEnv('SUPABASE_KEY', 'Missing SUPABASE_URL or SUPABASE_KEY');
    return {
        url,
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
        },
    };
}
function requireWorkerBaseUrl() {
    return requireEnv('WORKER_BASE_URL', 'Missing WORKER_BASE_URL for outbound messaging').replace(/\/$/, '');
}
function getTwilioCredentials() {
    const accountSid = readEnv('TWILIO_ACCOUNT_SID');
    const authToken = readEnv('TWILIO_AUTH_TOKEN');
    if (!accountSid || !authToken) {
        throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
    }
    return { accountSid, authToken };
}
function getInstantlyApiKey() {
    return readEnv('INSTANTLY_API_KEY');
}
function getGoogleMapsApiKey() {
    return (readEnv('GOOGLE_MAPS_API_KEY') ||
        readEnv('GOOGLE_GEOCODING_API_KEY') ||
        readEnv('GOOGLE_DIRECTIONS_API_KEY') ||
        '');
}
