import type { CRMLead, CRMQuote } from "@/lib/types";

export type SubcontractorStatus = "active" | "paused" | "blocked";
export type SubcontractorOfferStatus =
  "draft" | "open" | "awarded" | "cancelled" | "expired";
export type SubcontractorRecipientStatus =
  | "pending"
  | "sent"
  | "viewed"
  | "accepted"
  | "declined"
  | "discussion"
  | "not_awarded"
  | "send_failed";
export type SubcontractorAwardPolicy = "first_acceptance" | "manual_selection";
export type SubcontractorTruckAccess = "owns" | "rents" | "labour_only";

export interface Subcontractor {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  email?: string;
  status: SubcontractorStatus;
  branches: string[];
  serviceCities: string[];
  serviceTags: string[];
  truckAccess: SubcontractorTruckAccess;
  truckSizes: string[];
  maxCrewSize?: number;
  insured: boolean;
  insuranceExpiresAt?: string;
  availabilityNotes?: string;
  notes?: string;
  completedJobs: number;
  cancelledJobs: number;
  averageRating?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubcontractorOfferRecipient {
  id: string;
  offerId: string;
  subcontractorId: string;
  token?: string;
  status: SubcontractorRecipientStatus;
  sentAt?: string;
  viewedAt?: string;
  respondedAt?: string;
  responseNote?: string;
  smsError?: string;
  subcontractor?: Subcontractor;
}

export interface SubcontractorOffer {
  id: string;
  leadId: string;
  quoteId?: string;
  branch?: string;
  moveDate?: string;
  arrivalWindow?: string;
  originCity: string;
  destinationCity: string;
  distanceKm?: number;
  estimatedHoursMin?: number;
  estimatedHoursMax?: number;
  suggestedTruck?: string;
  crewSize?: number;
  requiredServiceTags: string[];
  inventory: unknown[];
  accessSummary: Record<string, unknown>;
  scopeNotes?: string;
  sanitizedBriefing?: string;
  awardedCrewBriefing?: string;
  readinessSnapshot?: Record<string, unknown>;
  autoPrepared?: boolean;
  offeredPayout: number;
  currency: string;
  status: SubcontractorOfferStatus;
  awardPolicy: SubcontractorAwardPolicy;
  expiresAt?: string;
  awardedSubcontractorId?: string;
  awardedAt?: string;
  createdByUserId?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  recipients?: SubcontractorOfferRecipient[];
}

export interface ContractorEligibility {
  eligible: boolean;
  score: number;
  reasons: string[];
  warnings: string[];
}

function clean(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function includesNormalized(values: string[], target?: string | null) {
  const normalized = clean(target);
  return !normalized || values.some((value) => clean(value) === normalized);
}

export function evaluateSubcontractorEligibility(
  contractor: Pick<
    Subcontractor,
    | "status"
    | "branches"
    | "serviceCities"
    | "serviceTags"
    | "truckSizes"
    | "maxCrewSize"
    | "insured"
    | "insuranceExpiresAt"
    | "completedJobs"
    | "cancelledJobs"
    | "averageRating"
  > &
    Partial<Pick<Subcontractor, "truckAccess">>,
  requirements: {
    branch?: string;
    originCity?: string;
    destinationCity?: string;
    crewSize?: number;
    truckSize?: string;
    serviceTags?: string[];
    moveDate?: string;
  },
): ContractorEligibility {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const truckAccess = contractor.truckAccess || "rents";
  if (contractor.status !== "active")
    reasons.push(`Contractor is ${contractor.status}`);
  if (
    requirements.branch &&
    contractor.branches.length > 0 &&
    !includesNormalized(contractor.branches, requirements.branch)
  )
    reasons.push("Outside assigned branch");
  if (
    requirements.originCity &&
    contractor.serviceCities.length > 0 &&
    !includesNormalized(contractor.serviceCities, requirements.originCity)
  )
    reasons.push("Origin city is outside service area");
  if (
    requirements.crewSize &&
    contractor.maxCrewSize &&
    contractor.maxCrewSize < requirements.crewSize
  )
    reasons.push(`Crew capacity is below ${requirements.crewSize}`);
  if (requirements.truckSize && truckAccess === "labour_only")
    reasons.push(
      "This contractor provides labour only; a truck must be supplied separately",
    );
  if (
    requirements.truckSize &&
    truckAccess !== "labour_only" &&
    contractor.truckSizes.length > 0 &&
    !includesNormalized(contractor.truckSizes, requirements.truckSize)
  )
    reasons.push(`Required ${requirements.truckSize} truck is unavailable`);
  if (requirements.truckSize && truckAccess === "rents")
    warnings.push("Truck rental must be confirmed for this job");
  const contractorTags = new Set(contractor.serviceTags.map(clean));
  const missingTags = (requirements.serviceTags || []).filter(
    (tag) => !contractorTags.has(clean(tag)),
  );
  if (missingTags.length > 0)
    reasons.push(`Missing service tags: ${missingTags.join(", ")}`);
  if (!contractor.insured) reasons.push("Insurance not verified");
  if (
    requirements.moveDate &&
    contractor.insuranceExpiresAt &&
    contractor.insuranceExpiresAt < requirements.moveDate
  )
    reasons.push("Insurance expires before move date");
  if (contractor.insuranceExpiresAt && !requirements.moveDate)
    warnings.push(`Insurance expires ${contractor.insuranceExpiresAt}`);

  const totalOutcomes = contractor.completedJobs + contractor.cancelledJobs;
  const completionRate = totalOutcomes
    ? contractor.completedJobs / totalOutcomes
    : 0.75;
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        45 +
          completionRate * 30 +
          (contractor.averageRating || 4) * 5 -
          reasons.length * 30,
      ),
    ),
  );
  return { eligible: reasons.length === 0, score, reasons, warnings };
}

export function buildOfferDefaults(lead: CRMLead, quote: CRMQuote | null) {
  const hours = Number(quote?.estimatedHours || 0);
  return {
    branch: lead.branch,
    moveDate: lead.moveDate || quote?.moveDate,
    originCity: lead.originCity || "Origin TBD",
    destinationCity: lead.destCity || "Destination TBD",
    estimatedHoursMin: hours ? Math.max(1, hours - 1) : undefined,
    estimatedHoursMax: hours ? hours + 1 : undefined,
    suggestedTruck: lead.truckSize,
    crewSize: quote?.crewSize,
    inventory: lead.inventory || [],
    accessSummary: {
      origin: lead.originAccess || "",
      destination: lead.destAccess || "",
      parking: lead.parkingNotes || "",
    },
    scopeNotes: lead.crewNote,
  };
}

export function buildSubcontractorOfferSms(input: {
  companyName: string;
  moveDate?: string;
  arrivalWindow?: string;
  originCity: string;
  destinationCity: string;
  estimatedHoursMin?: number;
  estimatedHoursMax?: number;
  crewSize?: number;
  payout: number;
  currency: string;
  url: string;
}) {
  const hours =
    input.estimatedHoursMin || input.estimatedHoursMax
      ? `${input.estimatedHoursMin || "?"}-${input.estimatedHoursMax || "?"}h`
      : "hours TBD";
  return `Saturn Star job offer for ${input.companyName}: ${input.moveDate || "date TBD"}${input.arrivalWindow ? ` (${input.arrivalWindow})` : ""}, ${input.originCity} to ${input.destinationCity}, ${hours}, ${input.crewSize || "?"} crew. Payout: ${input.currency} $${input.payout.toFixed(2)}. Accept, decline, or ask a question: ${input.url}`;
}
