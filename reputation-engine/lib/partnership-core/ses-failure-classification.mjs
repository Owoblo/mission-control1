// Preserve the canonical bounce safety gate; distinguish the cause for reporting.
export function sesFailureClass(event) {
 if(event.event_type!=='email_bounced')return event.event_type;
 let payload=event.payload;
 try {
  if(typeof payload==='string')payload=JSON.parse(payload);
  if(typeof payload?.Message==='string')payload=JSON.parse(payload.Message);
 }catch{return 'bounce_unclassified';}
 const subtype=payload?.bounce?.bounceSubType;
 if(subtype==='EmailValidationSuppressed')return 'validation_blocked';
 if(['Suppressed','OnAccountSuppressionList'].includes(subtype))return 'suppression_blocked';
 return 'delivery_bounced';
}
