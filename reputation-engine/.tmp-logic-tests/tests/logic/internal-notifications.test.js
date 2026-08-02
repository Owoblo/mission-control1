"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_module_1 = __importDefault(require("node:module"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const originalResolveFilename = node_module_1.default._resolveFilename;
node_module_1.default._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
        return originalResolveFilename(node_path_1.default.join(__dirname, '../..', request.slice(2)), parent, isMain, options);
    }
    return originalResolveFilename(request, parent, isMain, options);
};
const { partnershipInboundNotificationEmail, sendPartnershipInboundAlert, } = require('../../lib/server/internal-notifications');
(0, node_test_1.default)('partnership inbound email renders downloaded MMS media as inline CID images', () => {
    const html = partnershipInboundNotificationEmail({
        contactId: 'contact-1',
        contactName: 'Steve Hatton',
        channel: 'sms',
        mediaUrls: ['https://api.twilio.com/private-image'],
        embeddedMedia: [{ contentId: 'partner-mms-1', filename: 'Attachment 1' }],
    });
    strict_1.default.match(html, /src="cid:partner-mms-1"/);
    strict_1.default.match(html, /Media attached \(1\)/);
    strict_1.default.doesNotMatch(html, /href="https:\/\/api\.twilio\.com\/private-image"/);
});
(0, node_test_1.default)('partnership inbound alert downloads Twilio MMS and sends it as an inline attachment', async () => {
    const originalFetch = global.fetch;
    const originalEnv = {
        resend: process.env.RESEND_API_KEY,
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
    };
    process.env.RESEND_API_KEY = 'resend-test';
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'twilio-test';
    let resendPayload = null;
    global.fetch = (async (input, init) => {
        const url = String(input);
        if (url.startsWith('https://api.twilio.com/')) {
            return new Response(Buffer.from('jpeg-bytes'), {
                status: 200,
                headers: { 'content-type': 'image/jpeg', 'content-length': '10' },
            });
        }
        if (url === 'https://api.resend.com/emails') {
            resendPayload = JSON.parse(String(init?.body || '{}'));
            return Response.json({ id: 'email-1' });
        }
        throw new Error(`Unexpected URL: ${url}`);
    });
    try {
        await sendPartnershipInboundAlert('Partner inbound SMS — Steve Hatton', {
            contactId: 'contact-1',
            contactName: 'Steve Hatton',
            channel: 'sms',
            mediaUrls: [
                'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/MM1/Media/ME1',
            ],
        }, ['business@starmovers.ca']);
        strict_1.default.ok(resendPayload);
        const capturedPayload = resendPayload;
        const attachments = capturedPayload.attachments;
        strict_1.default.equal(attachments.length, 1);
        strict_1.default.equal(attachments[0].filename, 'partner-mms-1.jpg');
        strict_1.default.equal(attachments[0].content_id, 'partner-mms-1');
        strict_1.default.equal(attachments[0].content, Buffer.from('jpeg-bytes').toString('base64'));
        strict_1.default.match(String(capturedPayload.html), /src="cid:partner-mms-1"/);
    }
    finally {
        global.fetch = originalFetch;
        if (originalEnv.resend === undefined)
            delete process.env.RESEND_API_KEY;
        else
            process.env.RESEND_API_KEY = originalEnv.resend;
        if (originalEnv.accountSid === undefined)
            delete process.env.TWILIO_ACCOUNT_SID;
        else
            process.env.TWILIO_ACCOUNT_SID = originalEnv.accountSid;
        if (originalEnv.authToken === undefined)
            delete process.env.TWILIO_AUTH_TOKEN;
        else
            process.env.TWILIO_AUTH_TOKEN = originalEnv.authToken;
    }
});
