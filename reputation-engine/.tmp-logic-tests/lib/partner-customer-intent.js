"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPartnerMovingLeadIntent = isPartnerMovingLeadIntent;
function isPartnerMovingLeadIntent(value) {
    const text = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!text)
        return false;
    const genericReferralOnly = /\b(if|when|whenever)\b.{0,40}\b(my|our|any)\s+(clients?|customers?)\b.{0,45}\b(move|moving|movers?)\b/.test(text) &&
        !/\b(i|i'm|i am|we|we're|we are|my wife|my husband|my family)\b.{0,45}\b(move|moving|relocat)/.test(text);
    if (genericReferralOnly)
        return false;
    return (/\bappointment booked\b.{0,45}\bmoving service\b/.test(text) ||
        /\b(i|i'm|i am|we|we're|we are|my wife|my husband|my family)\b.{0,55}\b(move|moving|relocat)/.test(text) ||
        /\bmy (house|home|residence|condo|apartment)\b.{0,45}\b(sold|moving|move)\b/.test(text) ||
        /\b(move|moving)\b.{0,40}\b(my|our)\s+(stuff|items?|furniture|belongings|house|home)\b/.test(text) ||
        /\bneed\b.{0,30}\b(help|quote|estimate|rates?)\b.{0,35}\b(move|moving|movers?)\b/.test(text) ||
        /\b(move|moving|movers?)\b.{0,35}\b(quote|estimate|rates?|availability|date)\b/.test(text) ||
        /\b(pickup|pick up|origin)\b.{0,120}\b(dropoff|drop off|destination)\b/.test(text));
}
