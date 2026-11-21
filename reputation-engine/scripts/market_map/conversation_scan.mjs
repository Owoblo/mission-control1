// Count-reconciled, bounded-time keyset scans; failed scans never claim complete.
export async function scanTable({table,filters={},cutoff,fetchPage,onReceipt=()=>{},pageSize=1000,maxPages=1000,idColumn='id',timeColumn='created_at'}){
 const base={...filters,order:idColumn+'.asc'};
 // created_at may already have a lower bound. PostgREST supports both via and.
 if(cutoff)base.and=`(${timeColumn}.lte.${cutoff})`;
 const receipt={table,filters:base,cutoff,started_at:new Date().toISOString(),state:'running',pages:0,rows:0,duplicates:0,expected:null,actual_after:null,last_id:null};
 const rows=[],seen=new Set();
 try{
  receipt.expected=(await fetchPage({...base,limit:'1'},true)).count;
  if(!Number.isSafeInteger(receipt.expected)||receipt.expected<0)throw Error('Missing exact source count');
  for(let page=0;page<maxPages;page++){
   const q={...base,limit:String(pageSize)};if(receipt.last_id)q[idColumn]='gt.'+receipt.last_id;
   const result=await fetchPage(q,false);receipt.pages++;
   for(const row of result.rows){if(!row[idColumn])throw Error('Missing stable record id');if(seen.has(row[idColumn])){receipt.duplicates++;continue}seen.add(row[idColumn]);rows.push(row)}
   receipt.rows=rows.length;
   const last=result.rows.at(-1)?.[idColumn];
   if(last&&receipt.last_id&&last<=receipt.last_id)throw Error('Non-progressing pagination');
   if(last)receipt.last_id=last;
   onReceipt({...receipt});
   if(result.rows.length<pageSize){
    receipt.actual_after=(await fetchPage({...base,limit:'1'},true)).count;
    if(receipt.duplicates||receipt.rows!==receipt.expected||receipt.actual_after!==receipt.expected)throw Error('Source count changed or scan count mismatch; replay required');
    receipt.state='complete';receipt.finished_at=new Date().toISOString();onReceipt({...receipt});return {rows,receipt};
   }
  }throw Error('Page limit reached; scan incomplete');
 }catch(e){receipt.state='incomplete';receipt.error=e.message;onReceipt({...receipt});const error=Error(table+': '+e.message);error.receipt=receipt;throw error}
}
