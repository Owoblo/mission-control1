/** Planning only: neither daily capacity nor a source row grants permission to send. */
export function dailySupplyPlan({dailyBudget=4000,dueFollowups=0,readyInitials=0,readyFollowups=0,bufferTarget=1000,preparedReserveTarget=7000}={}){
 for(const value of [dailyBudget,dueFollowups,readyInitials,readyFollowups,bufferTarget,preparedReserveTarget])if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid supply count');
 const followupSlots=Math.min(dailyBudget,dueFollowups);
 const initialSlots=dailyBudget-followupSlots;
 return {dailyBudget,followupSlots,initialSlots,followupsToPrepare:Math.max(0,followupSlots-readyFollowups),initialsToPrepare:Math.max(0,initialSlots-readyInitials),bufferTarget,bufferShortfall:Math.max(0,bufferTarget-readyInitials-readyFollowups),preparedReserveTarget,preparedReserveShortfall:Math.max(0,preparedReserveTarget-readyInitials-readyFollowups),scope:'Preparation target only; final eligibility and sender health still required'};
}
