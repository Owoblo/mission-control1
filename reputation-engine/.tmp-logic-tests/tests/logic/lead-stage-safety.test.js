"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const lead_stage_safety_1 = require("../../lib/lead-stage-safety");
(0, node_test_1.default)('automation cannot recommend the manual-only lost stage', () => {
    strict_1.default.equal((0, lead_stage_safety_1.sanitizeAutomatedStageSuggestion)('lost'), undefined);
});
(0, node_test_1.default)('automation can still recommend active sales stages', () => {
    strict_1.default.equal((0, lead_stage_safety_1.sanitizeAutomatedStageSuggestion)('nurture'), 'nurture');
    strict_1.default.equal((0, lead_stage_safety_1.sanitizeAutomatedStageSuggestion)('booked'), 'booked');
});
(0, node_test_1.default)('unknown model output cannot become a CRM stage', () => {
    strict_1.default.equal((0, lead_stage_safety_1.sanitizeAutomatedStageSuggestion)('closed_won'), undefined);
    strict_1.default.equal((0, lead_stage_safety_1.sanitizeAutomatedStageSuggestion)(null), undefined);
});
