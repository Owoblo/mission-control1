import {createHash} from 'node:crypto';
export function completedReviewBatch(text,marker,knownIds=new Set()){
 if(marker?.complete!==true)throw Error('Review batch not complete');
 const rows=text.trim()?text.trim().split('\n').map(JSON.parse):[];
 if(rows.length!==marker.count)throw Error('Review marker count mismatch');
 if(rows.some(r=>!r.organisation_id||!r.email)||new Set(rows.map(r=>r.organisation_id)).size!==rows.length)throw Error('Missing or duplicate review identity');
 return {sha256:createHash('sha256').update(text).digest('hex'),rows:rows.filter(r=>!knownIds.has(r.organisation_id)),total:rows.length};
}
export function supplyStatus({pending=0,running=0,ready=0,floor=1000}){
 const queued=pending+running;
 return {queued,ready,lowWatermark:floor,reviewNeeded:Math.max(0,floor-queued-ready),state:queued===0&&ready===0?'needs_review_supply':queued<floor?'below_watermark':'buffered'};
}
