import {deliveryExposure as base} from './realtor-delivery-exposure-20261015.mjs';
export function deliveryExposure(jobs,events,target=2000){
 // Finalized sending_failed (carrier rejection) is terminal, not an unresolved send.
 const terminalEvents=events.map(e=>e.event_type==='message.finalized'&&e.status==='sending_failed'?{...e,status:'delivery_failed'}:e);
 const value=base(jobs,terminalEvents,target);
 const confirmed_unsent=jobs.filter(j=>!j.provider_sid&&((j.status==='failed'&&j.last_error==='confirmed_unsent_pre_provider_20261019')||(j.status==='cancelled'&&j.last_error==='excess_exposure_cancelled_20261019'))).length;
 const unresolved=value.unresolved-confirmed_unsent;
 return {...value,confirmed_unsent,unresolved,available:Math.max(0,target-value.delivered-unresolved)};
}
