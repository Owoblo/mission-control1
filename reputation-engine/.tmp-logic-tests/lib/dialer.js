"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectBrowserCompatibility = detectBrowserCompatibility;
exports.getDialerStorageKey = getDialerStorageKey;
function detectBrowserCompatibility(userAgent) {
    const ua = userAgent || '';
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
    let browser = 'Unknown';
    let browserFamily = 'unknown';
    let version = '';
    if (/Edg\//i.test(ua)) {
        browser = 'Microsoft Edge';
        browserFamily = 'edge';
        version = ua.match(/Edg\/([\d.]+)/i)?.[1] || '';
    }
    else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) {
        browser = 'Google Chrome';
        browserFamily = 'chrome';
        version = ua.match(/Chrome\/([\d.]+)/i)?.[1] || '';
    }
    else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
        browser = 'Safari';
        browserFamily = 'safari';
        version = ua.match(/Version\/([\d.]+)/i)?.[1] || '';
    }
    else if (/Firefox\//i.test(ua)) {
        browser = 'Firefox';
        browserFamily = 'firefox';
        version = ua.match(/Firefox\/([\d.]+)/i)?.[1] || '';
    }
    let os = 'Unknown OS';
    if (/Windows/i.test(ua))
        os = 'Windows';
    else if (/Mac OS X/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua))
        os = 'macOS';
    else if (/Android/i.test(ua))
        os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua))
        os = 'iOS';
    else if (/Linux/i.test(ua))
        os = 'Linux';
    let warning = null;
    let recommended = false;
    if (browserFamily === 'chrome' && !isMobile) {
        recommended = true;
    }
    else if (browserFamily === 'edge' && !isMobile) {
        warning = 'Edge is supported, but Chrome desktop is recommended for best audio device support.';
    }
    else if (browserFamily === 'safari') {
        warning = 'Safari has weaker WebRTC and audio-device support. Chrome desktop is recommended.';
    }
    else if (isMobile) {
        warning = 'Mobile browsers are less reliable for voice. Use Chrome desktop for browser calls.';
    }
    else {
        warning = 'Chrome desktop is recommended for browser calling.';
    }
    return {
        browser,
        browserFamily,
        browserVersion: version,
        os,
        platform: isMobile ? 'mobile' : 'desktop',
        recommended,
        warning,
    };
}
function getDialerStorageKey(userId) {
    return `dialer_events:${userId || 'anonymous'}`;
}
