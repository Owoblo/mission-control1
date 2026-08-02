"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const sales_validation_1 = require("../../lib/server/sales-validation");
{
    const updates = (0, sales_validation_1.validateLeadPatchPayload)({
        followUpDate: '2026-05-15',
    });
    strict_1.default.equal(updates.followUpDate, '2026-05-15');
}
