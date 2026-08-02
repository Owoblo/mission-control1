"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const sales_automation_inventory_sms_1 = require("../../lib/sales-automation-inventory-sms");
const baseLead = {
    id: 'lead_inventory_discovery',
    name: 'Ezgi',
    stage: 'new',
};
const listingMessage = (0, sales_automation_inventory_sms_1.buildMlsInventoryConfirmationSms)({
    ...baseLead,
    inventory: [
        { name: 'Sofa', room: 'Living Room', qty: 1, source: 'mls', cubicFeet: 55, weightLbs: 180 },
        { name: 'Nightstand', room: 'Bedroom 1', qty: 2, source: 'mls', cubicFeet: 8, weightLbs: 25 },
    ],
});
strict_1.default.match(listingMessage, /property information available in our system/i);
strict_1.default.match(listingMessage, /don't have to list everything from scratch/i);
strict_1.default.match(listingMessage, /Living Room: Sofa/i);
strict_1.default.match(listingMessage, /Bedroom 1: 2 Nightstand/i);
strict_1.default.equal((listingMessage.match(/\?/g) || []).length, 1);
strict_1.default.doesNotMatch(listingMessage, /\b(price|quote|estimate|\$)\b/i);
const surveyUrl = 'https://go.quote2move.com/survey/surv_test';
const fallbackMessage = (0, sales_automation_inventory_sms_1.buildPhotoSurveyFallbackMessage)(baseLead, surveyUrl);
strict_1.default.match(fallbackMessage, /property information in our system/i);
strict_1.default.match(fallbackMessage, /completely fine/i);
strict_1.default.match(fallbackMessage, /text the main furniture/i);
strict_1.default.match(fallbackMessage, /upload a few room photos/i);
strict_1.default.match(fallbackMessage, new RegExp(surveyUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
strict_1.default.equal((fallbackMessage.match(/\?/g) || []).length, 1);
strict_1.default.doesNotMatch(fallbackMessage, /\b(price|quote|estimate|\$)\b/i);
console.log('inventory discovery copy tests passed');
