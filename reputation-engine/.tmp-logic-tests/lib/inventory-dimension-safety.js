"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDetectedInventoryDimensions = normalizeDetectedInventoryDimensions;
const item_presets_1 = require("./item-presets");
const GROUP_LABEL_RE = /\b(stack|group|assorted|collection|set of|lot of|boxes|bins|chairs|monitors|stools|suitcases|baskets)\b/i;
function finitePositive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}
/**
 * AI providers occasionally return dimensions for the whole visible group while
 * also returning qty > 1. CRM totals are per-unit, so normalize obvious grouped
 * totals before they can be multiplied a second time.
 */
function normalizeDetectedInventoryDimensions(input) {
    const qty = Math.max(1, Math.round(finitePositive(input.qty) || 1));
    let cubicFeet = finitePositive(input.cubicFeet);
    let weightLbs = finitePositive(input.weightLbs);
    const preset = (0, item_presets_1.matchInventoryPreset)(input.name);
    const presetCubicFeet = finitePositive(preset?.item.cubicFeet);
    const presetWeight = finitePositive(preset?.item.weightLbs);
    if (qty > 1) {
        const exceedsKnownPerUnit = (presetCubicFeet > 0 && cubicFeet > presetCubicFeet * 2.25) ||
            (presetWeight > 0 && weightLbs > presetWeight * 2.75);
        const looksGrouped = GROUP_LABEL_RE.test(input.name) &&
            ((cubicFeet >= 20 && cubicFeet / qty >= 0.5) || (weightLbs >= 80 && weightLbs / qty >= 3));
        if (exceedsKnownPerUnit || looksGrouped) {
            cubicFeet = cubicFeet > 0 ? cubicFeet / qty : 0;
            weightLbs = weightLbs > 0 ? weightLbs / qty : 0;
            return {
                cubicFeet: Math.round(cubicFeet * 10) / 10,
                weightLbs: Math.round(weightLbs * 10) / 10,
                adjusted: true,
                reason: 'Converted an AI group total to per-item dimensions before quantity multiplication.',
            };
        }
    }
    const specialty = /\b(piano|safe|hot tub|pool table|pinball|appliance|fridge|freezer)\b/i.test(input.name);
    const cubicCap = specialty ? 200 : Math.max(150, presetCubicFeet * 3);
    const weightCap = specialty ? 1500 : Math.max(750, presetWeight * 4);
    const cappedCubicFeet = Math.min(cubicFeet, cubicCap);
    const cappedWeight = Math.min(weightLbs, weightCap);
    const adjusted = cappedCubicFeet !== cubicFeet || cappedWeight !== weightLbs;
    return {
        cubicFeet: Math.round(cappedCubicFeet * 10) / 10,
        weightLbs: Math.round(cappedWeight * 10) / 10,
        adjusted,
        ...(adjusted ? { reason: 'Capped implausible AI per-item dimensions for manual review.' } : {}),
    };
}
