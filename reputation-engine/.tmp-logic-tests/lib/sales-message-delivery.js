"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wasSalesMessageDelivered = wasSalesMessageDelivered;
function wasSalesMessageDelivered(result) {
    return !result.deduped && !Boolean(result.result.blocked);
}
