"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSessionCookieName = getSessionCookieName;
exports.getSessionCookieOptions = getSessionCookieOptions;
exports.getExpiredSessionCookieOptions = getExpiredSessionCookieOptions;
exports.shouldRefreshSession = shouldRefreshSession;
exports.createSessionToken = createSessionToken;
exports.getSessionPayload = getSessionPayload;
exports.verifySessionToken = verifySessionToken;
const runtime_1 = require("@/lib/server/runtime");
const SESSION_COOKIE = 'mc_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const SESSION_REFRESH_WINDOW_MS = 1000 * 60 * 60 * 24;
function toBase64Url(input) {
    const bytes = typeof input === 'string'
        ? new TextEncoder().encode(input)
        : new Uint8Array(input);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromBase64Url(input) {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '==='.slice((normalized.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}
async function sign(value, secret) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
    return toBase64Url(signature);
}
function getAuthSecret() {
    return (0, runtime_1.requireEnv)('AUTH_SECRET');
}
function getSessionCookieName() {
    return SESSION_COOKIE;
}
function getSessionCookieOptions(options) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: options?.maxAge ?? Math.floor(SESSION_TTL_MS / 1000),
    };
}
function getExpiredSessionCookieOptions() {
    return {
        ...getSessionCookieOptions({ maxAge: 0 }),
        expires: new Date(0),
    };
}
function shouldRefreshSession(payload, now = Date.now()) {
    return payload.exp - now <= SESSION_REFRESH_WINDOW_MS;
}
async function createSessionToken(options) {
    const payload = {
        exp: Date.now() + SESSION_TTL_MS,
        ...options,
    };
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const encodedSignature = await sign(encodedPayload, getAuthSecret());
    return `${encodedPayload}.${encodedSignature}`;
}
async function getSessionPayload(token) {
    if (!token)
        return null;
    const [encodedPayload, encodedSignature] = token.split('.');
    if (!encodedPayload || !encodedSignature)
        return null;
    const expectedSignature = await sign(encodedPayload, getAuthSecret());
    if (expectedSignature !== encodedSignature)
        return null;
    try {
        const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
        if (typeof payload.exp !== 'number' || payload.exp <= Date.now())
            return null;
        return payload;
    }
    catch {
        return null;
    }
}
async function verifySessionToken(token) {
    return (await getSessionPayload(token)) !== null;
}
