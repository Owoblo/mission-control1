"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.smsMessageBelongsToPhone = smsMessageBelongsToPhone;
function phoneDigits(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
}
function smsMessageBelongsToPhone(message, phone) {
    const expected = phoneDigits(phone);
    if (!expected)
        return false;
    return phoneDigits(message.from_number) === expected || phoneDigits(message.to_number) === expected;
}
