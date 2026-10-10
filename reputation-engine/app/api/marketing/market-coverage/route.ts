import {NextResponse} from 'next/server'
import {getSessionUser} from '@/lib/server/session'
import {requireSupabaseEnv} from '@/lib/server/runtime'
import {canSeeAllPartnershipMarkets,isPartnershipManager,partnershipRecordMatchesSession} from '@/lib/server/partnership-access'
import {summarizeCoverage,type CoverageReport} from '@/lib/partner-market-coverage'
export const dynamic='force-dynamic'
export async function GET(request:Request){
 const session=await getSessionUser()
 if(!session||(!canSeeAllPartnershipMarkets(session)&&!isPartnershipManager(session)))return NextResponse.json({error:'Unauthorized'},{status:401})
 try{
  const {url,headers}=requireSupabaseEnv()
  const response=await fetch(`${url}/rest/v1/partner_market_coverage_snapshots?select=report&order=generated_at.desc&limit=1`,{headers,cache:'no-store'})
  if(!response.ok)throw Error('Snapshot unavailable')
  const [row]=await response.json()
  if(!row)return NextResponse.json({error:'The first market coverage snapshot has not completed yet.'},{status:503})
  const report=row.report as CoverageReport
  if(report.version!==1||!Array.isArray(report.partitions))throw Error('Unsupported snapshot')
  // Scope before computing totals, rankings and filter options; other markets never reach the browser.
  const scoped={...report,partitions:report.partitions.filter(p=>partnershipRecordMatchesSession(session,p))}
  const params=new URL(request.url).searchParams
  return NextResponse.json(summarizeCoverage(scoped,{city:params.get('city')||undefined,lane:params.get('lane')||undefined,kind:params.get('kind')||undefined}))
 }catch{return NextResponse.json({error:'Market coverage could not be loaded. No partial totals are shown.'},{status:503})}
}
