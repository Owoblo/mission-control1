export type EstimateWorkflowStageId =
  | 'lead'
  | 'origin'
  | 'destination'
  | 'inventory'
  | 'handling'
  | 'plan'
  | 'review'

export type EstimateWorkflowStage = {
  id: EstimateWorkflowStageId
  label: string
  description: string
  status: 'complete' | 'needs_attention' | 'not_started'
  issueCount: number
}

type ReadinessInput = {
  category: 'evidence' | 'inventory' | 'logistics' | 'commercial'
  label: string
  ready: boolean
  critical?: boolean
}

export function buildEstimateWorkflowStages(input: {
  readiness: ReadinessInput[]
  laborOnly: boolean
  hasLeadContext: boolean
  hasOrigin: boolean
  hasDestination: boolean
  hasInventory: boolean
  hasHandlingPlan: boolean
  hasOperationalPlan: boolean
  hasPrice: boolean
}): EstimateWorkflowStage[] {
  const issues = (predicate: (item: ReadinessInput) => boolean) => input.readiness.filter(item => !item.ready && predicate(item))
  const stage = (
    id: EstimateWorkflowStageId,
    label: string,
    description: string,
    started: boolean,
    stageIssues: ReadinessInput[]
  ): EstimateWorkflowStage => ({
    id,
    label,
    description,
    status: stageIssues.length ? (started ? 'needs_attention' : 'not_started') : 'complete',
    issueCount: stageIssues.length,
  })

  const stages: EstimateWorkflowStage[] = [
    stage('lead', 'Move basics', 'Customer, move type, date, and service context.', input.hasLeadContext,
      issues(item => ['Customer name', 'Phone', 'Email or SMS available', 'Move date'].includes(item.label))),
    stage('origin', input.laborOnly ? 'Work location' : 'Origin', input.laborOnly ? 'Where the crew will perform the work.' : 'Pickup address, property, parking, and carrying route.', input.hasOrigin,
      issues(item => item.label.toLowerCase().includes('origin') || item.label.toLowerCase().includes('work location'))),
  ]

  if (!input.laborOnly) {
    stages.push(stage('destination', 'Destination', 'Delivery address, property, parking, and carrying route.', input.hasDestination,
      issues(item => item.label.toLowerCase().includes('destination'))))
  }

  stages.push(
    stage('inventory', 'Inventory', 'Room-by-room scope, evidence, and hidden-area confirmations.', input.hasInventory,
      issues(item => item.category === 'inventory' || item.category === 'evidence')),
    stage('handling', 'Handling', 'Packing, protection, assembly, specialty pieces, and exceptions.', input.hasHandlingPlan,
      issues(item => ['Packing status', 'Boxes asked', 'Item-path intelligence', 'Specialty fulfillment priced'].includes(item.label))),
    stage('plan', 'Move plan', 'Crew, trucks, operational time, route, and internal economics.', input.hasOperationalPlan,
      issues(item => item.category === 'commercial' && item.label !== 'Quote explanation available')),
    stage('review', 'Review & preview', 'Confirm the complete customer scope before delivery.', input.hasPrice,
      issues(item => item.critical === true))
  )

  return stages
}

export function nextEstimateWorkflowStage(
  stages: EstimateWorkflowStage[],
  current: EstimateWorkflowStageId,
  direction: 1 | -1
) {
  const index = Math.max(0, stages.findIndex(stage => stage.id === current))
  return stages[Math.min(stages.length - 1, Math.max(0, index + direction))]?.id || current
}
