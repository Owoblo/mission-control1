"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripeAccountMismatchError = exports.StripeAccountConfigurationError = void 0;
exports.resolveStripeAccountKeyForLead = resolveStripeAccountKeyForLead;
exports.readStripeAccountConfig = readStripeAccountConfig;
exports.requireStripeAccountForLead = requireStripeAccountForLead;
exports.requireStripeWebhookAccount = requireStripeWebhookAccount;
exports.assertQuoteStripeAccount = assertQuoteStripeAccount;
exports.reusableStripeCustomerId = reusableStripeCustomerId;
exports.appendStripeAccountMetadata = appendStripeAccountMetadata;
exports.webhookMetadataMatchesAccount = webhookMetadataMatchesAccount;
exports.stripeErrorStatus = stripeErrorStatus;
const sales_1 = require("../sales");
const runtime_1 = require("./runtime");
class StripeAccountConfigurationError extends Error {
    constructor() {
        super(...arguments);
        this.status = 503;
    }
}
exports.StripeAccountConfigurationError = StripeAccountConfigurationError;
class StripeAccountMismatchError extends Error {
    constructor() {
        super(...arguments);
        this.status = 409;
    }
}
exports.StripeAccountMismatchError = StripeAccountMismatchError;
function resolveStripeAccountKeyForLead(lead) {
    // Payment ownership follows the branch servicing the pickup. Destination is
    // only a fallback when the pickup market cannot be identified.
    const branch = lead.branch
        || (0, sales_1.detectSalesBranchFromLocation)(lead.originAddress, lead.originCity)
        || (0, sales_1.detectSalesBranchFromLocation)(lead.destAddress, lead.destCity);
    return branch === 'ottawa' ? 'dexa' : 'saturn';
}
function readStripeAccountConfig(key) {
    if (key === 'dexa') {
        return {
            key,
            brandName: 'Dexa Movers',
            secretKey: (0, runtime_1.readEnv)('DEXA_STRIPE_SECRET_KEY'),
            publishableKey: (0, runtime_1.readEnv)('DEXA_STRIPE_PUBLISHABLE_KEY'),
            webhookSecret: (0, runtime_1.readEnv)('DEXA_STRIPE_WEBHOOK_SECRET'),
        };
    }
    return {
        key,
        brandName: 'Saturn Star Moving',
        secretKey: (0, runtime_1.readEnv)('STRIPE_SECRET_KEY'),
        publishableKey: (0, runtime_1.readEnv)('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY') || (0, runtime_1.readEnv)('STRIPE_PUBLISHABLE_KEY'),
        webhookSecret: (0, runtime_1.readEnv)('STRIPE_WEBHOOK_SECRET'),
    };
}
function requireStripeAccountForLead(lead) {
    const account = readStripeAccountConfig(resolveStripeAccountKeyForLead(lead));
    if (!account.secretKey) {
        throw new StripeAccountConfigurationError(account.key === 'dexa'
            ? 'Dexa Stripe is not configured. Ottawa payments are blocked until Dexa credentials are added.'
            : 'Saturn Star Stripe is not configured.');
    }
    return account;
}
function requireStripeWebhookAccount(key) {
    const account = readStripeAccountConfig(key);
    if (!account.secretKey || !account.webhookSecret) {
        throw new StripeAccountConfigurationError(key === 'dexa' ? 'Dexa Stripe webhook is not configured.' : 'Saturn Star Stripe webhook is not configured.');
    }
    return account;
}
function assertQuoteStripeAccount(quote, expected) {
    if (quote.stripeAccountKey && quote.stripeAccountKey !== expected) {
        throw new StripeAccountMismatchError(`Payment account mismatch: this quote belongs to ${quote.stripeAccountKey}, not ${expected}.`);
    }
}
function reusableStripeCustomerId(quote, expected) {
    if (!quote?.depositStripeCustomerId)
        return '';
    assertQuoteStripeAccount(quote, expected);
    // Existing unlabelled IDs predate Dexa isolation and therefore belong to
    // Saturn. Never send one to Dexa, where Stripe object IDs are account-local.
    if (!quote.stripeAccountKey && expected === 'dexa')
        return '';
    return quote.depositStripeCustomerId;
}
function appendStripeAccountMetadata(params, account, prefix = 'metadata') {
    params.set(`${prefix}[stripeAccountKey]`, account.key);
    params.set(`${prefix}[paymentBrand]`, account.brandName);
}
function webhookMetadataMatchesAccount(metadataAccount, expected) {
    if (expected === 'dexa')
        return metadataAccount === 'dexa';
    // Saturn accepts old events created before account provenance was introduced.
    return !metadataAccount || metadataAccount === 'saturn';
}
function stripeErrorStatus(error) {
    if (error instanceof StripeAccountConfigurationError || error instanceof StripeAccountMismatchError) {
        return error.status;
    }
    return 500;
}
