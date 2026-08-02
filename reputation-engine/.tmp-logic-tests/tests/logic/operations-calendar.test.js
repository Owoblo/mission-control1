"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const operations_calendar_1 = require("../../lib/operations-calendar");
const lead = { id: 'lead_staged', moveDate: '2026-08-04' };
const stagedQuote = {
    id: 'quote_staged',
    moveDate: '2026-08-04',
    legs: [
        {
            id: 'pickup',
            label: 'Pickup → storage',
            type: 'storage',
            scheduledDate: '2026-08-04',
            originAddress: '10 First St',
            destAddress: 'Saturn Star Storage',
        },
        {
            id: 'delivery',
            label: 'Storage → new home',
            type: 'storage_delivery',
            scheduledDate: '2026-08-22',
            originAddress: 'Saturn Star Storage',
            destAddress: '20 Second St',
        },
    ],
};
const stagedOccurrences = (0, operations_calendar_1.getOperationsCalendarOccurrences)(lead, stagedQuote);
strict_1.default.deepEqual(stagedOccurrences.map(item => item.date), ['2026-08-04', '2026-08-22']);
strict_1.default.deepEqual(stagedOccurrences.map(item => item.legLabel), ['Pickup → storage', 'Storage → new home']);
strict_1.default.equal(stagedOccurrences[1]?.destinationAddress, '20 Second St');
strict_1.default.equal((0, operations_calendar_1.hasOperationsOccurrenceOnDate)(lead, stagedQuote, '2026-08-22'), true);
const sameDayLegs = (0, operations_calendar_1.getOperationsCalendarOccurrences)(lead, {
    ...stagedQuote,
    legs: stagedQuote.legs?.map(leg => ({ ...leg, scheduledDate: '2026-08-04' })),
});
strict_1.default.equal(sameDayLegs.length, 2, 'two same-day legs remain two operational commitments');
const ordinaryOccurrences = (0, operations_calendar_1.getOperationsCalendarOccurrences)({ id: 'lead_ordinary', moveDate: '2026-08-09' }, { id: 'quote_ordinary', moveDate: '2026-08-10' });
strict_1.default.deepEqual(ordinaryOccurrences, [{
        key: 'quote_ordinary:move:2026-08-09',
        date: '2026-08-09',
    }]);
const partiallyDated = (0, operations_calendar_1.getOperationsCalendarOccurrences)(lead, {
    ...stagedQuote,
    legs: [
        { ...stagedQuote.legs[0], scheduledDate: undefined },
        { ...stagedQuote.legs[1], scheduledDate: '2026-08-22' },
    ],
});
strict_1.default.deepEqual(partiallyDated.map(item => item.date), ['2026-08-04', '2026-08-22']);
strict_1.default.deepEqual((0, operations_calendar_1.getOperationsCalendarOccurrences)({ id: 'undated' }, { id: 'undated_quote' }), []);
