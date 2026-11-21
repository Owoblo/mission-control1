// Evidence-only triage, never an outbound-message or Sales-creation decision.
export function classifyReview(contact,touch){
 const text=String(touch?.notes||'').replace(/^Inbound SMS:\s*/i,'').trim();
 const m=touch?.metadata||{};
 if(m.partnership_review?.reply_required===false)return {kind:'reviewed_no_reply',reason:'Saved contextual review already handled the reply obligation.'};
 if(contact?.do_not_contact||contact?.cross_channel_suppressed_at||contact?.email_unsubscribed_at||['bad_number','opted_out','rejected'].includes(contact?.decision)||contact?.stage==='dnc'||/^\s*(stop|unsubscribe|remove me)[.!\s]*$/i.test(text))return {kind:'suppressed_or_invalid_route',reason:'Suppression or invalid-recipient evidence; no outreach action.'};
 if(m.internal_report||/internal (email infrastructure )?test/i.test(contact?.name||''))return {kind:'internal_report',reason:'Internal account/report, not a prospect enquiry.'};
 if(/^SES event:/i.test(text))return {kind:'provider_event',reason:'Delivery/open/bounce event is not a human reply.'};
 if(/^(Liked|Loved|Laughed at|Disliked|Emphasized|Questioned|Reacted)\b|^赞了[：:]|^[\s\u200b-\u200f]*(?:👍|❤|❤️|🙏).*?\bto\s+[“"']/iu.test(text))return {kind:'reaction_only',reason:'Reaction wrapper quotes previous copy; quoted requests are not new requests.'};
 if(/^Call recorded|^Inbound call received|^Missed partnership call/i.test(text)||touch?.channel==='phone')return {kind:'call_context_review',reason:'Review actual call context/outcome; a call log is not itself a moving enquiry.'};
 if(/This number does not accept incoming text messages|this number is not monitored regularly|\(This is an automated message\)|verification was received[\s\S]*PENDING Review/i.test(text))return {kind:'automated_notification',reason:'Explicit automated/unmonitored-route notice; retain evidence without treating as a human request.'};
 return {kind:'human_context_review',reason:'Meaning or obligation remains unresolved; keep full history for review.'};
}
export const needsContextReview=r=>['human_context_review','call_context_review'].includes(r.kind);
