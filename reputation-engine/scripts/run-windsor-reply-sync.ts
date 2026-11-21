import { syncPartnershipZohoReplies } from '../lib/server/partnership-zoho-sync'
import fs from 'node:fs/promises'
async function main(){const result=await syncPartnershipZohoReplies();await fs.writeFile('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/send-release/zoho-sync-receipt.json',JSON.stringify({at:new Date().toISOString(),...result},null,2));console.log(result)}
main().catch(e=>{console.error(e.message);process.exitCode=1})
