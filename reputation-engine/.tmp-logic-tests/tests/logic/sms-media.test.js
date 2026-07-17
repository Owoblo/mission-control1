"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sms_media_1 = require("../../lib/sms-media");
(0, node_test_1.default)('SMS media helpers strip Twilio MMS markers from customer text', () => {
    const body = 'Everytime I upload it get this\n[MMS: https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM123/Media/ME123]';
    strict_1.default.equal((0, sms_media_1.stripMmsMarkersFromBody)(body), 'Everytime I upload it get this');
    strict_1.default.deepEqual((0, sms_media_1.extractMmsUrlsFromBody)(body), [
        'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM123/Media/ME123',
    ]);
});
(0, node_test_1.default)('SMS media helpers normalize explicit media and body marker URLs without duplicates', () => {
    const url = 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM123/Media/ME123';
    strict_1.default.deepEqual((0, sms_media_1.normalizeSmsMediaUrls)({
        body: `Photo attached\n[MMS: ${url}]`,
        media: [{ url }],
        metadata: { mediaUrls: [url] },
    }), [url]);
    strict_1.default.equal((0, sms_media_1.isTwilioApiMediaUrl)(url), true);
    strict_1.default.equal((0, sms_media_1.isTwilioApiMediaUrl)('https://example.com/photo.jpg'), false);
});
