"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canUseAllMobilePhoneLines = canUseAllMobilePhoneLines;
exports.listMobilePhoneLines = listMobilePhoneLines;
exports.canUseMobilePhoneLine = canUseMobilePhoneLine;
const sales_phones_1 = require("../sales-phones");
function sessionBranch(session) {
    return (0, sales_phones_1.getSalesBranchFromSaturnLabel)(session?.branch) || session?.branch?.toLowerCase();
}
function canUseAllMobilePhoneLines(session) {
    return session?.role === 'owner' || (session?.role === 'manager' && !session.branch);
}
function listMobilePhoneLines(session) {
    if (!session)
        return [];
    const branch = sessionBranch(session);
    return (0, sales_phones_1.getSaturnBranchPhoneNumbers)()
        .filter(number => {
        if (canUseAllMobilePhoneLines(session))
            return true;
        const workspace = (0, sales_phones_1.getSaturnTrackingSource)(number) === 'partnership_outreach'
            ? 'partnership'
            : 'sales';
        if (!branch || (0, sales_phones_1.getSalesBranchFromSaturnPhone)(number) !== branch)
            return false;
        if (session.role === 'sales_rep')
            return workspace === 'sales';
        if (session.role === 'partnership_manager')
            return workspace === 'partnership';
        return true;
    })
        .map(number => ({
        number,
        label: (0, sales_phones_1.getSaturnBranchLabel)(number) || number,
        workspace: (0, sales_phones_1.getSaturnTrackingSource)(number) === 'partnership_outreach'
            ? 'partnership'
            : 'sales',
        branch: (0, sales_phones_1.getSalesBranchFromSaturnPhone)(number) || '',
    }));
}
function canUseMobilePhoneLine(session, number) {
    return listMobilePhoneLines(session).some(line => line.number === number);
}
