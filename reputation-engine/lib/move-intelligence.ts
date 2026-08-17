import type {
  CRMLead,
  CRMQuote,
  HandlingComplexityLevel,
  IntelligenceEvidence,
  InventoryItem,
  ItemHandlingProfile,
  ItemPathAssessment,
  JobFactors,
  MoveIntelligenceAssessment,
  MoveIntelligenceQuestion,
} from './types'

const HIGH_IMPACT = /\b(safe|piano|treadmill|elliptical|armoire|wardrobe|sectional|sleeper|sofa bed|pool table|hot tub|gun safe)\b/i
const DISASSEMBLY = /\b(bed|bed frame|bunk|crib|table|desk|wardrobe|armoire|sectional|treadmill|trampoline)\b/i
const FRAGILE = /\b(glass|mirror|marble|stone|granite|tv|television|artwork|china|aquarium)\b/i
const VERY_FRAGILE = /\b(glass table|marble|granite|aquarium|grandfather clock|chandelier)\b/i
const FLEXIBLE = /\b(mattress|rug|bag|blanket)\b/i
const BULKY = /\b(sofa|couch|sectional|mattress|bed|armoire|wardrobe|dresser|refrigerator|fridge|freezer|treadmill|piano)\b/i
const OVERSIZED = /\b(king|california king|85["” ]|90["” ]|oversized|grand piano|hot tub|pool table|large sectional)\b/i
const SPECIALTY = /\b(safe|piano|hot tub|pool table|aquarium|grandfather clock)\b/i
const SLEEPER = /\b(sleeper|sofa bed|pull[- ]?out|hide[- ]?a[- ]?bed)\b/i

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value))
}

function quarterHour(minutes: number) {
  return Math.round((minutes / 60) * 4) / 4
}

function itemText(item: InventoryItem) {
  return `${item.name || item.item || ''} ${item.size || ''} ${item.notes || ''}`.trim()
}

function itemKey(item: InventoryItem, index: number) {
  return item.id || `${(item.roomId || item.sourcePhotoRoom || item.room || 'room').toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${(item.name || item.item || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${index}`
}

function evidence<T>(value: T | undefined, status: IntelligenceEvidence<T>['status'], confidence: number, source: string, reason?: string): IntelligenceEvidence<T> {
  return { value, status, confidence: clamp(confidence, 0, 1), source, reason }
}

function weightClass(weight?: number): ItemHandlingProfile['weightClass'] {
  if (!weight || weight <= 0) return 'unknown'
  if (weight < 50) return 'light'
  if (weight < 120) return 'medium'
  if (weight < 250) return 'heavy'
  return 'very_heavy'
}

function bulkClass(item: InventoryItem, text: string): ItemHandlingProfile['bulkClass'] {
  const volume = Number(item.cubicFeet || 0)
  if (OVERSIZED.test(text) || volume >= 100) return 'oversized'
  if (BULKY.test(text) || volume >= 55) return 'bulky'
  if (volume > 0 && volume <= 15) return 'compact'
  return volume > 0 ? 'standard' : 'unknown'
}

export function deriveItemHandlingProfile(item: InventoryItem): ItemHandlingProfile {
  const text = itemText(item)
  const weight = weightClass(Number(item.weightLbs || 0))
  const bulk = bulkClass(item, text)
  const sleeperProbability = SLEEPER.test(text) ? 0.98 : /\b(sofa|couch|loveseat)\b/i.test(text) ? 0.22 : 0
  const disassemblyLikelihood = DISASSEMBLY.test(text) ? (/\b(bed frame|bunk|crib|wardrobe|armoire|treadmill)\b/i.test(text) ? 0.9 : 0.7) : 0.08
  const fragility = VERY_FRAGILE.test(text) ? 'very_fragile' : FRAGILE.test(text) ? 'fragile' : 'normal'
  const rigidity = FLEXIBLE.test(text) ? 'flexible' : /\b(sectional|bed|table|sofa|dresser|safe|piano|tv)\b/i.test(text) ? 'rigid' : 'unknown'
  const gripDifficulty = /\b(mattress|sofa|sectional|armoire|safe|piano|glass|marble|treadmill)\b/i.test(text)
    ? (weight === 'very_heavy' || bulk === 'oversized' ? 'very_awkward' : 'awkward')
    : 'normal'

  let score = 10
  if (weight === 'medium') score += 8
  if (weight === 'heavy') score += 20
  if (weight === 'very_heavy') score += 34
  if (bulk === 'bulky') score += 16
  if (bulk === 'oversized') score += 28
  if (fragility === 'fragile') score += 14
  if (fragility === 'very_fragile') score += 25
  if (gripDifficulty === 'awkward') score += 10
  if (gripDifficulty === 'very_awkward') score += 18
  if (sleeperProbability >= 0.8) score += 20
  if (SPECIALTY.test(text)) score += 28
  score = clamp(score)

  const level: HandlingComplexityLevel = SPECIALTY.test(text) || score >= 85
    ? 'specialty'
    : score >= 65 ? 'high' : score >= 38 ? 'elevated' : 'standard'
  const requiredMovers = level === 'specialty' || weight === 'very_heavy' ? 3 : (bulk === 'oversized' || weight === 'heavy' || fragility !== 'normal' ? 2 : 1)
  const flags = [
    sleeperProbability >= 0.8 ? 'sleeper_mechanism' : null,
    disassemblyLikelihood >= 0.65 ? 'likely_disassembly' : null,
    bulk === 'oversized' ? 'oversized' : null,
    weight === 'very_heavy' ? 'very_heavy' : null,
    fragility !== 'normal' ? fragility : null,
    SPECIALTY.test(text) ? 'specialty_handling' : null,
  ].filter((value): value is string => Boolean(value))
  const specialEquipment = [
    weight === 'heavy' || weight === 'very_heavy' ? 'appliance/furniture dolly' : null,
    fragility !== 'normal' ? 'specialty protection' : null,
    /\btv|television\b/i.test(text) ? 'TV box' : null,
    SPECIALTY.test(text) ? 'specialty handling review' : null,
  ].filter((value): value is string => Boolean(value))

  return {
    level,
    score,
    weightClass: weight,
    bulkClass: bulk,
    rigidity,
    fragility,
    gripDifficulty,
    disassemblyLikelihood,
    sleeperProbability,
    requiredMovers,
    specialEquipment: Array.from(new Set(specialEquipment)),
    flags,
    evidence: [
      evidence(text, item.source === 'customer_verification' || item.source === 'manual' ? 'verified' : 'inferred', item.confidence ?? 0.7, item.source || 'inventory', 'Handling profile derived from item description, dimensions, weight, and notes'),
    ],
  }
}

function inferRoomFloor(item: InventoryItem, side: 'origin' | 'destination', factors: JobFactors): IntelligenceEvidence<number> {
  const explicit = side === 'origin' ? item.originFloor : item.destinationFloor
  const explicitConfidence = side === 'origin' ? item.originFloorConfidence : item.destinationFloorConfidence
  if (explicit !== undefined) {
    const verified = (explicitConfidence ?? 1) >= 0.95
    return evidence(explicit, verified ? 'verified' : 'inferred', explicitConfidence ?? 1, 'inventory item', 'Floor assigned to the item')
  }

  const room = `${side === 'origin' ? item.roomId || item.sourcePhotoRoom || item.room : item.destinationRoom || ''}`.toLowerCase()
  if (/basement|cellar|lower/.test(room)) return evidence(-1, 'inferred', 0.86, 'room label', `Room label "${room}" suggests basement`)
  if (/garage|outdoor|patio|main|ground|kitchen|dining|living/.test(room)) return evidence(1, 'inferred', 0.72, 'room label', `Room label "${room}" suggests ground/main floor`)

  const floors = side === 'origin' ? factors.originFloors : factors.destFloors
  if (floors && floors > 1 && /bedroom|primary|master/.test(room)) {
    return evidence(Math.min(floors, 2), 'inferred', 0.58, 'room + property inference', 'Bedroom is likely upstairs, but its floor is not confirmed')
  }
  return evidence<number>(undefined, 'unknown', 0, 'not observed', 'Item floor is not known')
}

function stairEvidence(floor: IntelligenceEvidence<number>, hasElevator?: boolean): IntelligenceEvidence<number> {
  if (hasElevator === true) return evidence(0, floor.status === 'verified' ? 'verified' : 'inferred', Math.max(0.6, floor.confidence), 'access profile', 'Elevator is available')
  if (floor.value === undefined) return evidence<number>(undefined, 'unknown', 0, 'not observed', 'Floor or vertical route is unknown')
  const flights = floor.value < 0 ? Math.abs(floor.value) : Math.max(0, floor.value - 1)
  return evidence(flights, floor.status, floor.confidence, floor.source, hasElevator === false ? 'No elevator reported' : 'Elevator availability is unknown')
}

function pathComplexityLevel(score: number, handling: ItemHandlingProfile): HandlingComplexityLevel {
  if (handling.level === 'specialty' || score >= 88) return 'specialty'
  if (score >= 65) return 'high'
  if (score >= 38) return 'elevated'
  return 'standard'
}

function assessPath(item: InventoryItem, index: number, factors: JobFactors): ItemPathAssessment {
  const handling = item.handlingProfile || deriveItemHandlingProfile(item)
  const originFloor = inferRoomFloor(item, 'origin', factors)
  const destinationFloor = inferRoomFloor(item, 'destination', factors)
  const originStairs = stairEvidence(originFloor, factors.originHasElevator)
  const destinationStairs = stairEvidence(destinationFloor, factors.destHasElevator)
  const verifiedFlights = [originStairs, destinationStairs]
    .filter(value => value.status === 'verified')
    .reduce((sum, value) => sum + Number(value.value || 0), 0)
  const allLikelyFlights = Number(originStairs.value || 0) + Number(destinationStairs.value || 0)
  const carryFeet = Number(factors.originCarryDistanceFeet || 0) + Number(factors.destCarryDistanceFeet || 0)
  const geometryRisk = [factors.originNarrowDoorwayRisk, factors.originTightTurnRisk, factors.destNarrowDoorwayRisk, factors.destTightTurnRisk].filter(Boolean).length
  const pathScore = clamp(handling.score * 0.65 + Math.min(24, allLikelyFlights * 8) + Math.min(10, carryFeet / 30) + geometryRisk * 7)
  const risks = [
    handling.sleeperProbability >= 0.8 ? 'Sleeper mechanism adds concealed weight and awkward handling' : null,
    handling.bulkClass === 'oversized' && geometryRisk > 0 ? 'Oversized item may not clear a narrow doorway or tight turn' : null,
    handling.level === 'specialty' ? 'Specialty handling or equipment review required' : null,
    handling.level !== 'standard' && originFloor.status === 'unknown' ? 'Origin floor/path unknown for a significant item' : null,
    handling.level !== 'standard' && destinationFloor.status === 'unknown' ? 'Destination floor/path unknown for a significant item' : null,
    allLikelyFlights > 0 && handling.level !== 'standard' ? `${allLikelyFlights} likely stair flight(s) interact with elevated item handling` : null,
  ].filter((value): value is string => Boolean(value))

  // Only verified physical path work affects the calculated price. Generic weight,
  // disassembly and access time are already handled by the legacy estimator.
  const pricedExtraMinutes = verifiedFlights > 0 && handling.level !== 'standard'
    ? Math.round(verifiedFlights * (handling.level === 'specialty' ? 12 : handling.level === 'high' ? 8 : 4) * Math.max(1, Number(item.qty || 1)))
    : 0

  return {
    itemKey: itemKey(item, index),
    itemLabel: item.name || item.item || 'Item',
    quantity: Math.max(1, Number(item.qty || 1)),
    originRoom: evidence(item.roomId || item.sourcePhotoRoom || item.room, item.room || item.roomId || item.sourcePhotoRoom ? (item.source === 'manual' || item.source === 'customer_verification' ? 'verified' : 'inferred') : 'unknown', item.confidence ?? 0.65, item.source || 'inventory'),
    originFloor,
    destinationRoom: evidence(item.destinationRoom, item.destinationRoom ? 'verified' : 'unknown', item.destinationRoom ? 1 : 0, item.destinationRoom ? 'move plan' : 'not observed'),
    destinationFloor,
    originStairFlights: originStairs,
    destinationStairFlights: destinationStairs,
    handling,
    pathScore,
    complexity: pathComplexityLevel(pathScore, handling),
    pricedExtraMinutes,
    risks,
  }
}

function addQuestion(target: MoveIntelligenceQuestion[], question: MoveIntelligenceQuestion) {
  if (!target.some(existing => existing.id === question.id)) target.push(question)
}

function questionPriority(question: MoveIntelligenceQuestion) {
  return { critical: 3, high: 2, medium: 1, low: 0 }[question.impact]
}

export function assessMoveIntelligence(input: {
  inventory: InventoryItem[]
  jobFactors?: JobFactors
  originAddress?: string
  destinationAddress?: string
}): MoveIntelligenceAssessment {
  const factors = input.jobFactors || {}
  const included = input.inventory.filter(item => item.included !== false)
  const paths = included.map((item, index) => assessPath(item, index, factors))
  const significant = paths.filter(path => path.handling.level === 'high' || path.handling.level === 'specialty' || path.complexity === 'high' || path.complexity === 'specialty')
  const pathRelevant = paths.filter(path => path.handling.level !== 'standard' || path.complexity !== 'standard')
  const questions: MoveIntelligenceQuestion[] = []

  for (const path of pathRelevant) {
    if (path.originFloor.status !== 'verified') {
      addQuestion(questions, {
        id: `origin-floor:${path.itemKey}`,
        itemKey: path.itemKey,
        impact: path.complexity === 'specialty' ? 'critical' : 'high',
        question: `Which floor is the ${path.itemLabel} on at the origin?`,
        reason: 'Its floor changes stair labor, required movers, and fit risk.',
      })
    }
    if (path.destinationFloor.status !== 'verified') {
      addQuestion(questions, {
        id: `destination-floor:${path.itemKey}`,
        itemKey: path.itemKey,
        impact: path.complexity === 'specialty' ? 'critical' : 'high',
        question: `Which floor/room will the ${path.itemLabel} go to at the destination?`,
        reason: 'Destination placement changes unloading and reassembly work.',
      })
    }
    if (path.handling.sleeperProbability > 0 && path.handling.sleeperProbability < 0.8) {
      addQuestion(questions, {
        id: `sleeper:${path.itemKey}`,
        itemKey: path.itemKey,
        impact: 'high',
        question: `Does the ${path.itemLabel} contain a pull-out bed or sleeper mechanism?`,
        reason: 'A sleeper mechanism materially changes weight and handling.',
      })
    }
  }

  if (factors.originFloors && factors.originFloors > 1 && factors.originAccessStatus !== 'verified') {
    addQuestion(questions, { id: 'origin-stair-geometry', impact: 'high', question: 'Is the origin staircase straight, or does it have a tight turn/landing?', reason: 'Stair geometry determines whether bulky rigid items can exit safely.' })
  }
  if (factors.destFloors && factors.destFloors > 1 && factors.destAccessStatus !== 'verified') {
    addQuestion(questions, { id: 'destination-stair-geometry', impact: 'high', question: 'Is the destination staircase straight, or does it have a tight turn/landing?', reason: 'Destination stair geometry affects placement and fit.' })
  }
  if (factors.originHasElevator && !factors.originElevatorReserved) {
    addQuestion(questions, { id: 'origin-elevator', impact: 'critical', question: 'What is the confirmed origin elevator reservation window?', reason: 'An unreserved elevator can create major waiting time or prevent the move.' })
  }
  if (factors.destHasElevator && !factors.destElevatorReserved) {
    addQuestion(questions, { id: 'destination-elevator', impact: 'critical', question: 'What is the confirmed destination elevator reservation window?', reason: 'An unreserved elevator can create major waiting time or prevent unloading.' })
  }
  if (factors.originParkingOk === false || factors.destParkingOk === false) {
    addQuestion(questions, { id: 'truck-position', impact: 'high', question: 'Where can the truck legally park, and approximately how far is that point from the entrance?', reason: 'Truck position and carry distance directly affect labor time.' })
  }

  const itemConfidence = included.length === 0 ? 0 : included.reduce((sum, item) => {
    if (item.status === 'confirmed' || item.source === 'manual' || item.source === 'customer_verification') return sum + 1
    return sum + clamp(item.confidence ?? 0.45, 0, 1)
  }, 0) / included.length
  const accessKnown = [factors.originFloors, factors.originHasElevator, factors.originParkingOk, factors.destFloors, factors.destHasElevator, factors.destParkingOk]
  const knownAccessRatio = accessKnown.filter(value => value !== undefined).length / accessKnown.length
  const pathKnown = pathRelevant.length === 0 ? 1 : pathRelevant.reduce((sum, path) => sum + (path.originFloor.status === 'verified' ? 0.5 : 0) + (path.destinationFloor.status === 'verified' ? 0.5 : 0), 0) / pathRelevant.length
  const uncertaintyPct = Math.round(clamp(100 - (itemConfidence * 45 + knownAccessRatio * 25 + pathKnown * 30)))
  const handlingComplexityScore = paths.length ? Math.round(paths.reduce((sum, path) => sum + path.handling.score * path.quantity, 0) / paths.reduce((sum, path) => sum + path.quantity, 0)) : 0
  const accessComplexityScore = clamp(
    (Number(factors.originFloors || 1) - 1) * 10 +
    (Number(factors.destFloors || 1) - 1) * 10 +
    (factors.originParkingOk === false ? 20 : 0) +
    (factors.destParkingOk === false ? 20 : 0) +
    (factors.originHasElevator && !factors.originElevatorReserved ? 20 : 0) +
    (factors.destHasElevator && !factors.destElevatorReserved ? 20 : 0)
  )
  const score = Math.round(clamp(handlingComplexityScore * 0.48 + accessComplexityScore * 0.32 + uncertaintyPct * 0.2))
  const level: MoveIntelligenceAssessment['level'] = score >= 76 ? 'critical' : score >= 56 ? 'high' : score >= 31 ? 'medium' : 'low'
  const criticalQuestions = questions.filter(question => question.impact === 'critical')
  const highQuestions = questions.filter(question => question.impact === 'high')
  const readinessReasons: string[] = []
  if (included.length === 0) readinessReasons.push('No confirmed inventory is available.')
  if (!input.originAddress || !input.destinationAddress) readinessReasons.push('Both route addresses are required.')
  if (itemConfidence < 0.8) readinessReasons.push('Inventory confidence is below 80%.')
  if (knownAccessRatio < 0.67) readinessReasons.push('Origin or destination access is incomplete.')
  if (criticalQuestions.length) readinessReasons.push(`${criticalQuestions.length} critical operational question(s) remain unresolved.`)
  if (highQuestions.length) readinessReasons.push(`${highQuestions.length} high-impact question(s) remain unresolved.`)
  const fixedPriceReadiness: MoveIntelligenceAssessment['fixedPriceReadiness'] =
    criticalQuestions.length > 0 || (significant.some(path => path.handling.level === 'specialty') && !factors.moveIntelligenceApprovedAt)
      ? 'manual_review'
      : readinessReasons.length > 0 || uncertaintyPct > 20
        ? 'provisional'
        : 'ready'
  const risks = Array.from(new Set(paths.flatMap(path => path.risks)))

  return {
    version: 1,
    score,
    level,
    handlingComplexityScore,
    accessComplexityScore,
    uncertaintyPct,
    pricedExtraHours: quarterHour(paths.reduce((sum, path) => sum + path.pricedExtraMinutes, 0)),
    highComplexityItemCount: significant.reduce((sum, path) => sum + path.quantity, 0),
    paths,
    risks,
    questions: questions.sort((a, b) => questionPriority(b) - questionPriority(a)),
    fixedPriceReadiness,
    readinessReasons,
  }
}

export function evaluateQuoteIntelligenceSafety(lead: CRMLead, quote: CRMQuote) {
  const assessment = assessMoveIntelligence({
    inventory: lead.inventory || [],
    jobFactors: lead.jobFactors,
    originAddress: quote.originAddress || lead.originAddress,
    destinationAddress: quote.destAddress || lead.destAddress,
  })
  const binding = quote.billingModel === 'binding'
  return {
    assessment,
    allowed: !binding || assessment.fixedPriceReadiness === 'ready',
    reason: !binding || assessment.fixedPriceReadiness === 'ready'
      ? undefined
      : `Binding quote is ${assessment.fixedPriceReadiness}: ${assessment.readinessReasons.join(' ') || assessment.questions.map(question => question.question).join(' ')}`,
  }
}
