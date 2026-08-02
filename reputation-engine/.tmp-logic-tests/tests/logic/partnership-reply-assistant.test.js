"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_module_1 = __importDefault(require("node:module"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const originalResolveFilename = node_module_1.default._resolveFilename;
node_module_1.default._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
        return originalResolveFilename(node_path_1.default.join(__dirname, '../..', request.slice(2)), parent, isMain, options);
    }
    return originalResolveFilename(request, parent, isMain, options);
};
const { suggestPartnershipReply } = require('../../lib/server/partnership-reply-assistant');
const contact = {
    id: 'contact_1',
    name: 'Mak Cole',
    company: 'REMAX Preferred Realty',
    title: 'Realtor',
    email: null,
    phone: '+15199841037',
    city: 'Windsor',
    industry: 'real_estate',
    stage: 'replied',
    decision: null,
};
function inbound(notes) {
    return [{
            id: 'touch_1',
            channel: 'sms',
            direction: 'inbound',
            notes,
            created_by: null,
            created_at: '2026-06-18T16:48:00.000Z',
        }];
}
function conversation(notes) {
    return notes.map((item, index) => ({
        id: `touch_${index + 1}`,
        channel: 'sms',
        direction: item.direction,
        notes: item.text,
        created_by: item.direction === 'outbound' ? 'Hunter' : null,
        created_at: new Date(Date.UTC(2026, 5, 18, 16, 48 + index)).toISOString(),
    }));
}
(0, node_test_1.default)('partnership assistant treats client email info requests as package-forwarding requests', async () => {
    process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL = 'https://starmovers.ca/partner/mak-cole-windsor';
    process.env.PARTNERSHIP_RATE_CARD_URL = 'https://starmovers.ca/partner/flyers/windsor.pdf';
    process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL = 'https://starmovers.ca/quote';
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact,
        touches: inbound('Good afternoon hunter, I hope all is well. Do you have anything I can send to clients over email/ info about your business? Thank you'),
    });
    strict_1.default.equal(result.intent, 'asks_for_email');
    strict_1.default.equal(result.recommended_action, 'draft_reply');
    strict_1.default.match(result.draft_sms, /Mak/i);
    strict_1.default.match(result.draft_sms, /what email/i);
    strict_1.default.match(result.draft_sms, /flyer|rate card|referral|client quote/i);
    strict_1.default.doesNotMatch(result.draft_sms, /best address and time/i);
});
(0, node_test_1.default)('partnership assistant treats card or picture requests as media permission', async () => {
    process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL = 'https://starmovers.ca/partner/louie-lisi-windsor';
    process.env.PARTNERSHIP_FLYER_IMAGE_URL = 'https://starmovers.ca/partner/flyers/windsor.pdf';
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: { ...contact, name: 'Louie Lisi', phone: '+15199714263' },
        touches: inbound('Just text me your card thank you take a picture for me and send to me thanks'),
    });
    strict_1.default.equal(result.intent, 'send_card_or_flyer_media');
    strict_1.default.equal(result.recommended_action, 'draft_reply');
    strict_1.default.equal(result.goal_state.physical_delivery, 'not_needed');
    strict_1.default.equal(result.goal_state.digital_package, 'suggested');
    strict_1.default.match(result.draft_sms, /text.*card|card\/flyer/i);
    strict_1.default.match(result.draft_sms, /Is it okay if I send that here too\?/i);
    strict_1.default.deepEqual(result.suggested_media_urls, ['https://starmovers.ca/partner/flyers/windsor.pdf']);
});
(0, node_test_1.default)('partnership assistant handles digital card only replies without pushing office drop off', async () => {
    process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL = 'https://starmovers.ca/partner/simon-tan-windsor';
    process.env.PARTNERSHIP_FLYER_IMAGE_URL = 'https://starmovers.ca/partner/flyers/windsor.pdf';
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: { ...contact, name: 'Simon Tan', phone: '+15199715971' },
        touches: inbound("Thank you for the information, I don't go to the office very often, you can just send me your business card through this number. I will contact you when I need."),
    });
    strict_1.default.equal(result.intent, 'send_card_or_flyer_media');
    strict_1.default.equal(result.recommended_action, 'draft_reply');
    strict_1.default.equal(result.goal_state.physical_delivery, 'not_needed');
    strict_1.default.match(result.draft_sms, /card|flyer/i);
    strict_1.default.match(result.draft_sms, /Is it okay if I send that here too\?/i);
    strict_1.default.doesNotMatch(result.draft_sms, /best address|drop.*postcard|office/i);
});
(0, node_test_1.default)('partnership assistant auto-generates package links when env links are absent', async () => {
    delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL;
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.PARTNERSHIP_FLYER_IMAGE_URL;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: {
            ...contact,
            name: 'Simon Tan',
            city: 'Windsor',
            tracking_code: null,
            affiliate_partner_id: null,
        },
        touches: inbound('Thank you, you can just send me your business card through this number.'),
    });
    strict_1.default.equal(result.package_configured, true);
    strict_1.default.doesNotMatch(result.risk_flags.join(' '), /package_links_not_configured/);
    strict_1.default.deepEqual(result.suggested_media_urls, ['https://starmovers.ca/partner/flyers/windsor.pdf']);
});
(0, node_test_1.default)('partnership assistant treats go ahead after package permission ask as approval to send package', async () => {
    delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL;
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.PARTNERSHIP_FLYER_IMAGE_URL;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: { ...contact, name: 'Moe Fakih', city: 'Windsor' },
        touches: conversation([
            { direction: 'inbound', text: 'Hi Hunter, you can just text me your card here.' },
            { direction: 'outbound', text: 'For sure Moe, I can text the card/flyer here. I also have a short digital package with rates, referral info, and your client quote link in one place. Is it okay if I send that here too?' },
            { direction: 'inbound', text: 'Hey Hunter ya go ahead' },
        ]),
    });
    strict_1.default.equal(result.intent, 'positive_vague');
    strict_1.default.equal(result.recommended_action, 'send_package');
    strict_1.default.equal(result.goal_state.digital_package, 'ready_to_send');
    strict_1.default.match(result.draft_sms, /digital package: https:\/\/starmovers\.ca\/partner\/moe-fakih-windsor\?city=windsor/i);
    strict_1.default.doesNotMatch(result.draft_sms, /if that is okay|Is it okay|Is it cool/i);
});
(0, node_test_1.default)('partnership assistant treats go ahead after card drop ask as postcard approval only', async () => {
    delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL;
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.PARTNERSHIP_FLYER_IMAGE_URL;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: { ...contact, name: 'Moe Fakih', city: 'Windsor' },
        touches: conversation([
            { direction: 'outbound', text: 'Would it be okay if I stopped by your office next week to drop off a few cards?' },
            { direction: 'inbound', text: 'Loved “Would it be okay if I stopped by your office next week to drop off a few cards?”' },
            { direction: 'inbound', text: 'Hey Hunter ya go ahead' },
        ]),
    });
    strict_1.default.equal(result.intent, 'postcard_yes');
    strict_1.default.equal(result.recommended_action, 'draft_reply');
    strict_1.default.equal(result.goal_state.digital_package, 'suggested');
    strict_1.default.match(result.draft_sms, /What address and time work best/i);
    strict_1.default.match(result.draft_sms, /Is it okay if I send the full digital package here too\?/i);
    strict_1.default.match(result.draft_sms, /client quote link you can forward anytime/i);
    strict_1.default.doesNotMatch(result.draft_sms, /digital package: https:\/\//i);
    strict_1.default.doesNotMatch(result.risk_flags.join(' '), /needs_context_review/);
});
(0, node_test_1.default)('partnership assistant treats sms love reactions as soft acknowledgement', async () => {
    delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL;
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.PARTNERSHIP_FLYER_IMAGE_URL;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: { ...contact, name: 'Moe Fakih', city: 'Windsor' },
        touches: conversation([
            { direction: 'outbound', text: 'Would it be okay if I stopped by your office next week to drop off a few cards?' },
            { direction: 'inbound', text: 'Loved “Would it be okay if I stopped by your office next week to drop off a few cards?”' },
        ]),
    });
    strict_1.default.equal(result.intent, 'warm_acknowledgement');
    strict_1.default.match(result.risk_flags.join(' '), /sms_reaction_only/);
    strict_1.default.equal(result.recommended_action, 'draft_reply');
    strict_1.default.doesNotMatch(result.draft_sms, /digital package: https:\/\//i);
});
(0, node_test_1.default)('partnership assistant flags missing-context replies without closing as wrong number', async () => {
    delete process.env.OPENAI_API_KEY;
    for (const note of [
        "Hi there. Sorry I'm missing maybe part of a conversation?",
        "Sorry. I don't see an earlier text. What is this for?",
        'Who is this',
        "I'm sorry, who is this and what is this regarding?",
    ]) {
        const result = await suggestPartnershipReply({
            contact: { ...contact, name: 'Alyssa Ismail' },
            touches: inbound(note),
        });
        strict_1.default.equal(result.intent, 'asks_context');
        strict_1.default.equal(result.quick_action, 'needs_follow_up');
        strict_1.default.equal(result.recommended_action, 'draft_reply');
        strict_1.default.match(result.risk_flags.join(' '), /resend_previous_context/);
        strict_1.default.match(result.draft_sms, /Saturn Star Movers/i);
        strict_1.default.match(result.draft_sms, /resend the original note/i);
        strict_1.default.notEqual(result.intent, 'wrong_number');
    }
});
(0, node_test_1.default)('partnership assistant routes meeting requests through local relationship reps', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact,
        touches: inbound('Can you come by Tuesday afternoon to meet?'),
    });
    strict_1.default.equal(result.intent, 'wants_meeting');
    strict_1.default.equal(result.quick_action, 'meeting_requested');
    strict_1.default.match(result.draft_sms, /Mak/i);
    strict_1.default.match(result.draft_sms, /relationship managers/i);
    strict_1.default.doesNotMatch(result.draft_sms, /address should I come to|I can come|I'll come|I will come/i);
});
(0, node_test_1.default)('partnership assistant uses local team language for postcard drop offs', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact,
        touches: inbound('Sure, you can drop postcards off anytime.'),
    });
    strict_1.default.equal(result.quick_action, 'drop_cards');
    strict_1.default.match(result.draft_sms, /make arrangements to drop it off/i);
    strict_1.default.doesNotMatch(result.draft_sms, /I can drop|I'll drop|I will drop/i);
});
(0, node_test_1.default)('partnership assistant keeps low-referral-capacity drop offs low pressure', async () => {
    delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL;
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.PARTNERSHIP_FLYER_IMAGE_URL;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: {
            ...contact,
            name: 'Kevin Diluca',
            company: 'REMO VALENTE REAL ESTATE (1990) LIMITED',
        },
        touches: inbound('You can drop off cards to reception at Valente Real Estate on Dougall. I have a different position at the company an not selling very much'),
    });
    strict_1.default.equal(result.intent, 'drop_by_anytime');
    strict_1.default.equal(result.quick_action, 'drop_cards');
    strict_1.default.equal(result.extracted.low_referral_activity, true);
    strict_1.default.match(result.draft_sms, /Totally understand, Kevin/i);
    strict_1.default.match(result.draft_sms, /no pressure/i);
    strict_1.default.match(result.draft_sms, /leave a few cards at reception/i);
    strict_1.default.match(result.draft_sms, /even one client is helpful/i);
    strict_1.default.match(result.draft_sms, /Is it okay if I send the full digital package here too\?/i);
    strict_1.default.doesNotMatch(result.draft_sms, /What is the best address to use|What address and time work best|relationship managers/i);
    strict_1.default.doesNotMatch(result.draft_sms, /digital package: https:\/\//i);
});
(0, node_test_1.default)('partnership assistant answers social media requests and uses brokerage location hints', async () => {
    delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL;
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.PARTNERSHIP_FLYER_IMAGE_URL;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: {
            ...contact,
            name: 'Natalie Lazzarin-Gignac',
            company: 'ROYAL LEPAGE BINDER REAL ESTATE',
        },
        touches: inbound("Hey! Always open to new business and we always need movers! You certainly can. It's the Royal LePage on Provincial. Do you have a social media page"),
    });
    strict_1.default.equal(result.intent, 'asks_social_media');
    strict_1.default.equal(result.recommended_action, 'draft_reply');
    strict_1.default.equal(result.quick_action, 'drop_cards');
    strict_1.default.equal(result.extracted.asks_social_media, true);
    strict_1.default.match(result.extracted.brokerage_location || '', /Royal LePage on Provincial/i);
    strict_1.default.match(result.draft_sms, /Absolutely Natalie/i);
    strict_1.default.match(result.draft_sms, /yes we do/i);
    strict_1.default.match(result.draft_sms, /Royal LePage on Provincial works/i);
    strict_1.default.match(result.draft_sms, /make arrangements to drop it off/i);
    strict_1.default.match(result.draft_sms, /social links/i);
    strict_1.default.match(result.draft_sms, /referral details/i);
    strict_1.default.doesNotMatch(result.draft_sms, /What is the best address to use/i);
    strict_1.default.doesNotMatch(result.draft_sms, /digital package: https:\/\//i);
});
(0, node_test_1.default)('partnership assistant answers share-number email and website requests before package CTA', async () => {
    delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL;
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.PARTNERSHIP_FLYER_IMAGE_URL;
    delete process.env.PARTNERSHIP_PUBLIC_EMAIL;
    delete process.env.PARTNERSHIP_PUBLIC_WEBSITE;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: { ...contact, name: 'Rami Abraham', city: 'Windsor' },
        touches: inbound("Hi Hunter, thanks for reaching out. I'm not usually in the office. But I'll keep your number handy on my phone. Is this the number I can share with clients? And do you also have an email or website? Thanks"),
    });
    strict_1.default.equal(result.intent, 'asks_contact_info');
    strict_1.default.equal(result.recommended_action, 'draft_reply');
    strict_1.default.equal(result.goal_state.physical_delivery, 'not_needed');
    strict_1.default.equal(result.extracted.asks_share_number, true);
    strict_1.default.equal(result.extracted.asks_website, true);
    strict_1.default.match(result.draft_sms, /Rami/i);
    strict_1.default.match(result.draft_sms, /this number works for clients too/i);
    strict_1.default.match(result.draft_sms, /info@starmovers\.ca/i);
    strict_1.default.match(result.draft_sms, /starmovers\.ca/i);
    strict_1.default.match(result.draft_sms, /Is it okay if I send the full digital package here too\?/i);
    strict_1.default.doesNotMatch(result.draft_sms, /what email should I send|What address and time|drop the postcards/i);
});
(0, node_test_1.default)('partnership assistant answers identity after digital package email approval', async () => {
    delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL;
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.PARTNERSHIP_FLYER_IMAGE_URL;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: { ...contact, name: 'Rose Laflamme', city: 'Windsor' },
        touches: conversation([
            { direction: 'outbound', text: 'Perfect, thanks Rose. I will make arrangements to drop it off. What address and time work best? Is it okay if I send the full digital package here too?' },
            { direction: 'inbound', text: 'Digital is good. My email rose@jumprealty.ca' },
            { direction: 'inbound', text: 'Is this Hunter?' },
        ]),
    });
    strict_1.default.equal(result.intent, 'confirms_identity');
    strict_1.default.equal(result.recommended_action, 'send_package');
    strict_1.default.equal(result.goal_state.physical_delivery, 'not_needed');
    strict_1.default.equal(result.goal_state.digital_package, 'ready_to_send');
    strict_1.default.match(result.draft_sms, /Yes, Rose, this is Hunter/i);
    strict_1.default.match(result.draft_sms, /rose@jumprealty\.ca/i);
    strict_1.default.match(result.draft_sms, /digital package/i);
    strict_1.default.doesNotMatch(result.draft_sms, /What address and time|What is the best address|Is it okay if I send/i);
});
(0, node_test_1.default)('partnership assistant treats recent client referral requests as credibility requests', async () => {
    delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL;
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.PARTNERSHIP_FLYER_IMAGE_URL;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: { ...contact, name: 'Shaun Cushing', city: 'Windsor' },
        touches: inbound('Absolutely. If you could add a couple referrals of recent clients, that would be great as well'),
    });
    strict_1.default.equal(result.intent, 'asks_for_references');
    strict_1.default.equal(result.recommended_action, 'draft_reply');
    strict_1.default.equal(result.goal_state.physical_delivery, 'not_needed');
    strict_1.default.match(result.draft_sms, /For sure, Shaun/i);
    strict_1.default.match(result.draft_sms, /recent client feedback/i);
    strict_1.default.match(result.draft_sms, /referral examples/i);
    strict_1.default.match(result.draft_sms, /Is it okay if I send that here too\?/i);
    strict_1.default.doesNotMatch(result.draft_sms, /What address and time|drop the postcards|relationship managers/i);
});
(0, node_test_1.default)('partnership assistant extracts secondary contact handoffs', async () => {
    delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL;
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.PARTNERSHIP_FLYER_IMAGE_URL;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: { ...contact, name: 'Doris Lapico', city: 'Windsor' },
        touches: inbound('Please reach out to Julie my assistant at 5199662368 and she can help coordinate.'),
    });
    strict_1.default.equal(result.intent, 'refers_to_another_contact');
    strict_1.default.equal(result.recommended_action, 'draft_reply');
    strict_1.default.equal(result.goal_state.physical_delivery, 'not_needed');
    strict_1.default.equal(result.extracted.referred_person_name, 'Julie');
    strict_1.default.equal(result.extracted.referred_person_phone, '5199662368');
    strict_1.default.equal(result.extracted.referred_person_role, 'assistant');
    strict_1.default.match(result.draft_sms, /Thanks, Doris/i);
    strict_1.default.match(result.draft_sms, /reach out to Julie at 5199662368/i);
    strict_1.default.match(result.draft_sms, /digital package too/i);
});
(0, node_test_1.default)('partnership assistant treats referred lead updates as dispositions', async () => {
    delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL;
    delete process.env.PARTNERSHIP_RATE_CARD_URL;
    delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL;
    delete process.env.PARTNERSHIP_FLYER_IMAGE_URL;
    delete process.env.OPENAI_API_KEY;
    const result = await suggestPartnershipReply({
        contact: { ...contact, name: 'Ken Allen', city: 'Windsor' },
        touches: inbound("I don't believe they'll be using a mover. The house was vacant and had no furniture."),
    });
    strict_1.default.equal(result.intent, 'lead_disposition_update');
    strict_1.default.equal(result.recommended_action, 'draft_reply');
    strict_1.default.equal(result.goal_state.physical_delivery, 'not_needed');
    strict_1.default.match(result.extracted.lead_disposition || '', /no furniture/i);
    strict_1.default.match(result.draft_sms, /Thanks for the update, Ken/i);
    strict_1.default.match(result.draft_sms, /no worries at all/i);
    strict_1.default.doesNotMatch(result.draft_sms, /What address and time|drop it off/i);
});
