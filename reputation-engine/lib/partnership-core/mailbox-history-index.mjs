export function indexedMailboxHistory(index,email,domain,now=Date.now()){
 const started=Date.parse(index?.startedAt),completed=Date.parse(index?.completedAt);
 if(index?.complete!==true||!Number.isFinite(started)||!Number.isFinite(completed)||started>completed||completed>now+60000||now-started>15*60*1000)throw Error('Complete fresh mailbox index required');
 if(!['saturn','ottawa'].every(m=>index.markets?.some(x=>x.market===m&&Array.isArray(x.messages))))throw Error('Both mailbox histories required');
 const target=email.toLowerCase(),host=domain.toLowerCase().replace(/^www\./,'');const matches=[];
 for(const market of index.markets)for(const message of market.messages){
  if(!Array.isArray(message.addresses))throw Error('Malformed mailbox index');
  if(message.addresses.some(address=>address.toLowerCase()===target||address.toLowerCase().split('@')[1]===host))matches.push({mailbox:market.mailbox,messageId:message.messageId,receivedTime:message.receivedTime});
 }
 return matches;
}
