/** Run independent jobs concurrently; stop claiming new work after a failure. */
export async function runBoundedDispatch(items, concurrency, execute) {
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>16)throw Error('Invalid concurrency');
 let cursor=0,stopped=false;const results=[];
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
  while(!stopped&&cursor<items.length){const index=cursor++;
   try{results.push({index,ok:true,value:await execute(items[index])});}
   catch(error){stopped=true;results.push({index,ok:false,error:String(error?.message||error)});}
  }
 }));
 return {results:results.sort((a,b)=>a.index-b.index),stopped,unstarted:items.length-cursor};
}
export function serialGate(){let tail=Promise.resolve();return task=>{
 const result=tail.then(task);tail=result.catch(()=>{});return result;
};}
