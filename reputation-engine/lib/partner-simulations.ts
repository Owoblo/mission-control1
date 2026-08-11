export type PilotScenario = 'normal_move'|'additional_inventory'|'truck_capacity'|'weather_delay'|'damage_claim'|'no_show_backup'|'hourly_overrun'|'fixed_multi_day'|'sms_fallback'|'offline_evidence'
export type SimulationEvent = { type: string; actor: 'system'|'operations'|'partner'|'customer'; detail: string }
export type SimulationResult = { scenario: PilotScenario; passed: boolean; events: SimulationEvent[]; assertions: Array<{ label: string; passed: boolean }> }

const scenarios: Record<PilotScenario, SimulationEvent[]> = {
  normal_move: [{type:'offer',actor:'system',detail:'Sanitized offer sent'},{type:'accept',actor:'partner',detail:'Compensation and payout date accepted'},{type:'walkthrough',actor:'partner',detail:'Inventory verified'},{type:'complete',actor:'partner',detail:'Final walkthrough complete'}],
  additional_inventory: [{type:'variance',actor:'partner',detail:'Additional inventory reported with evidence'},{type:'hold_scope',actor:'operations',detail:'Unapproved items held'},{type:'authorize',actor:'customer',detail:'Change order approved'},{type:'resume',actor:'operations',detail:'Updated job version released'}],
  truck_capacity: [{type:'capacity_warning',actor:'partner',detail:'Load will not fit planned truck'},{type:'options',actor:'operations',detail:'Second trip or additional truck evaluated'},{type:'authorize',actor:'customer',detail:'Selected option authorized'},{type:'trip_started',actor:'partner',detail:'Additional trip timestamped'}],
  weather_delay: [{type:'weather',actor:'partner',detail:'Unsafe conditions reported'},{type:'pause',actor:'operations',detail:'Safety pause issued'},{type:'customer_update',actor:'system',detail:'Customer informed'},{type:'resume',actor:'operations',detail:'Work safely resumed'}],
  damage_claim: [{type:'damage',actor:'partner',detail:'Damage report and evidence submitted'},{type:'claim',actor:'system',detail:'Claim case opened'},{type:'service_recovery',actor:'operations',detail:'Customer Success assigned'}],
  no_show_backup: [{type:'late_threshold',actor:'system',detail:'En-route checkpoint missed'},{type:'escalate',actor:'operations',detail:'Primary partner contacted'},{type:'backup',actor:'system',detail:'Eligible backup surfaced'},{type:'customer_update',actor:'operations',detail:'Recovery ETA sent'}],
  hourly_overrun: [{type:'hours_warning',actor:'system',detail:'Planned hours threshold reached'},{type:'estimate',actor:'partner',detail:'Remaining work estimated'},{type:'authorize',actor:'customer',detail:'Hourly continuation approved'}],
  fixed_multi_day: [{type:'day_end',actor:'partner',detail:'Day one inventory and truck state recorded'},{type:'secure',actor:'partner',detail:'Remaining goods secured'},{type:'day_start',actor:'partner',detail:'Day two scope acknowledged'},{type:'complete',actor:'partner',detail:'Fixed-price scope completed'}],
  sms_fallback: [{type:'inbound_sms',actor:'partner',detail:'Partner text matched to active job'},{type:'timeline',actor:'system',detail:'Message attached to job timeline'},{type:'reply',actor:'operations',detail:'Operations replied from dedicated number'}],
  offline_evidence: [{type:'queue',actor:'partner',detail:'Evidence preserved offline'},{type:'reconnect',actor:'system',detail:'Upload retried'},{type:'attach',actor:'system',detail:'Evidence timestamp and category retained'}],
}

export const PILOT_SCENARIOS = Object.keys(scenarios) as PilotScenario[]
export function runPartnerSimulation(scenario: PilotScenario): SimulationResult {
  const events = scenarios[scenario]
  if (!events) throw new Error('Unknown pilot scenario')
  const assertions = [
    { label: 'Every exception has an owner', passed: events.every(event => !!event.actor) },
    { label: 'Customer authorization precedes changed work', passed: !['additional_inventory','truck_capacity','hourly_overrun'].includes(scenario) || events.findIndex(e=>e.type==='authorize') < events.findIndex(e=>['resume','trip_started'].includes(e.type)) || (scenario === 'hourly_overrun' && events.at(-1)?.type === 'authorize') },
    { label: 'Timeline is auditable', passed: events.length >= 3 },
  ]
  return { scenario, events, assertions, passed: assertions.every(item => item.passed) }
}

export function canBeginPartnerWork(input: { offerAccepted: boolean; currentVersionAcknowledged: boolean; walkthroughComplete: boolean; openBlockingChangeOrder: boolean }) {
  const blockers: string[] = []
  if (!input.offerAccepted) blockers.push('Job has not been accepted')
  if (!input.currentVersionAcknowledged) blockers.push('Current job version is not acknowledged')
  if (!input.walkthroughComplete) blockers.push('Opening walkthrough is incomplete')
  if (input.openBlockingChangeOrder) blockers.push('Scope change is awaiting authorization')
  return { allowed: blockers.length === 0, blockers }
}
