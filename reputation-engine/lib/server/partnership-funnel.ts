export type FunnelObservation = {
  id: string
  routeVerified: boolean
  channelVerified: boolean
  releaseApproved: boolean
  queued: boolean
  providerAccepted: boolean
  deliveredOrReplied: boolean
}
export function partnershipFunnel(rows: FunnelObservation[]) {
  const stages = {
    researched: new Set<string>(),
    route_verified: new Set<string>(),
    channel_verified: new Set<string>(),
    release_approved: new Set<string>(),
    queued: new Set<string>(),
    provider_accepted: new Set<string>(),
    delivered_or_replied: new Set<string>(),
  }
  for (const r of rows) {
    stages.researched.add(r.id)
    if (r.routeVerified) stages.route_verified.add(r.id)
    if (r.channelVerified) stages.channel_verified.add(r.id)
    if (r.releaseApproved) stages.release_approved.add(r.id)
    if (r.queued) stages.queued.add(r.id)
    if (r.providerAccepted) stages.provider_accepted.add(r.id)
    if (r.deliveredOrReplied) stages.delivered_or_replied.add(r.id)
  }
  return Object.fromEntries(
    Object.entries(stages).map(([key, entities]) => [key, entities.size]),
  )
}
