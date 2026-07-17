"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sales_phones_1 = require("../../lib/sales-phones");
(0, node_test_1.default)('sales branch primary numbers map to the expected local Twilio lines', () => {
    strict_1.default.equal((0, sales_phones_1.getSaturnBranchNumberForSalesBranch)('windsor'), '+12267732993');
    strict_1.default.equal((0, sales_phones_1.getSaturnBranchNumberForSalesBranch)('waterloo'), '+12262423319');
    strict_1.default.equal((0, sales_phones_1.getSaturnBranchNumberForSalesBranch)('ottawa'), '+16135193236');
    strict_1.default.equal((0, sales_phones_1.getSaturnBranchNumberForSalesBranch)('london'), '+15484883245');
});
(0, node_test_1.default)('phone area code inference only claims markets with reliable local overlays', () => {
    strict_1.default.equal((0, sales_phones_1.inferSalesBranchFromPhoneAreaCode)('+16135551234'), 'ottawa');
    strict_1.default.equal((0, sales_phones_1.inferSalesBranchFromPhoneAreaCode)('+13435551234'), 'ottawa');
    strict_1.default.equal((0, sales_phones_1.inferSalesBranchFromPhoneAreaCode)('+15485551234'), 'london');
    strict_1.default.equal((0, sales_phones_1.inferSalesBranchFromPhoneAreaCode)('+12265551234'), undefined);
    strict_1.default.equal((0, sales_phones_1.inferSaturnBranchPhoneNumberFromPhone)('+16135551234'), '+16135193236');
});
(0, node_test_1.default)('city inference can recover the right local market from lead geography', () => {
    strict_1.default.equal((0, sales_phones_1.inferSalesBranchFromCity)('Kanata, ON'), 'ottawa');
    strict_1.default.equal((0, sales_phones_1.inferSalesBranchFromCity)('Waterloo Region'), 'waterloo');
    strict_1.default.equal((0, sales_phones_1.inferSalesBranchFromCity)('LaSalle'), 'windsor');
    strict_1.default.equal((0, sales_phones_1.inferSalesBranchFromCity)('St. Thomas'), 'london');
    strict_1.default.equal((0, sales_phones_1.inferSaturnBranchPhoneNumberFromCity)('Ottawa'), '+16135193236');
});
(0, node_test_1.default)('branch picking still falls back safely to the default line', () => {
    strict_1.default.equal((0, sales_phones_1.pickSaturnBranchPhoneNumber)('+16135193236', '+12267732993'), '+16135193236');
    strict_1.default.equal((0, sales_phones_1.pickSaturnBranchPhoneNumber)('not-a-branch', null), '+12267732993');
});
(0, node_test_1.default)('London inbound metadata stays attached to the London branch line', () => {
    const londonNumber = '+15484883245';
    strict_1.default.equal((0, sales_phones_1.getSaturnBusinessNumberFromSmsMessage)({
        direction: 'inbound',
        from_number: '+15195551234',
        to_number: londonNumber,
    }), londonNumber);
    strict_1.default.equal((0, sales_phones_1.getSaturnBranchNumberFromRawData)({
        to: londonNumber,
        branchNumber: londonNumber,
    }), londonNumber);
    strict_1.default.equal((0, sales_phones_1.getSalesBranchFromSaturnPhone)(londonNumber), 'london');
    strict_1.default.equal((0, sales_phones_1.getSaturnBranchLabel)(londonNumber), 'London');
});
