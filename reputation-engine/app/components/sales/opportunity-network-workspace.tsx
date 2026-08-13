"use client";

import { useState } from "react";
import { PartnerReferralSelector } from "./partner-referral-selector";
import {
  MOVE_RELATIONSHIP_CATEGORY_BY_ROLE,
  MOVE_RELATIONSHIP_ROLE_LABELS,
  normalizeMoveRelationships,
} from "@/lib/move-relationship";
import { updateSalesLead } from "@/lib/sales-api";
import type { PartnerDirectoryEntry } from "@/lib/partner-directory";
import type {
  CRMLead,
  MoveRelationship,
  MoveRelationshipRole,
} from "@/lib/types";

type Props = {
  lead: CRMLead;
  disabled?: boolean;
  onUpdated: (lead: CRMLead) => void;
};

function uid() {
  return `rel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function OpportunityNetworkWorkspace({
  lead,
  disabled,
  onUpdated,
}: Props) {
  const [relationships, setRelationships] = useState<MoveRelationship[]>(
    lead.moveRelationships || [],
  );
  const [selectedPartner, setSelectedPartner] =
    useState<PartnerDirectoryEntry | null>(null);
  const [relationshipRole, setRelationshipRole] =
    useState<MoveRelationshipRole>("listing_realtor");
  const [relationshipConfidence, setRelationshipConfidence] =
    useState<MoveRelationship["confidence"]>("confirmed");
  const [relationshipSource, setRelationshipSource] = useState("");
  const [addressConnection, setAddressConnection] =
    useState<NonNullable<MoveRelationship["addressConnection"]>>("origin");
  const [socialHandle, setSocialHandle] = useState("");
  const [preferredChannel, setPreferredChannel] =
    useState<MoveRelationship["preferredChannel"]>("unknown");
  const [reviewComplete, setReviewComplete] = useState(
    lead.opportunityContext?.relationshipReviewStatus === "complete",
  );
  const [reviewNote, setReviewNote] = useState(
    lead.opportunityContext?.relationshipReviewNote || "",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);

  function addRelationship(partner = selectedPartner) {
    if (!partner) return;
    setRelationships((current) =>
      normalizeMoveRelationships(
        current.concat({
          id: uid(),
          contactId: partner.id,
          name: partner.name,
          company: partner.company,
          role: relationshipRole,
          category: partner.category,
          email: partner.email,
          phone: partner.phone,
          addressConnection,
          connectedAddress:
            addressConnection === "origin"
              ? lead.originAddress
              : addressConnection === "destination"
                ? lead.destAddress
                : addressConnection === "both"
                  ? [lead.originAddress, lead.destAddress]
                      .filter(Boolean)
                      .join(" → ")
                  : undefined,
          socialHandle: socialHandle.trim() || undefined,
          preferredChannel,
          confidence: relationshipConfidence,
          discoverySource: relationshipSource.trim() || undefined,
          createdAt: new Date().toISOString(),
        }),
      ),
    );
    setSelectedPartner(null);
    setRelationshipSource("");
    setSocialHandle("");
    setPreferredChannel("unknown");
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const saved = await updateSalesLead(lead.id, {
        moveRelationships: normalizeMoveRelationships(relationships),
        opportunityContext: {
          ...(lead.opportunityContext || {
            position: "discovery",
            bookingConfidence: 35,
            nextAction: "",
            nextActionDueAt: "",
            nextActionOwner: "",
            updatedAt: new Date().toISOString(),
          }),
          relationshipReviewStatus: reviewComplete ? "complete" : "open",
          relationshipReviewNote: reviewNote.trim() || undefined,
          updatedAt: new Date().toISOString(),
        },
      });
      onUpdated(saved);
      setMessage("Move relationships saved.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save move relationships.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id="section-opportunity-network"
      className="border border-[var(--app-line)] bg-white"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`block w-full bg-[#071421] px-5 text-left text-white md:px-7 ${expanded ? "py-5" : "py-4"}`}
        aria-expanded={expanded}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#d6b53a]">
              Move relationship graph
            </div>
            <h2
              className={`mt-0.5 font-display font-semibold ${expanded ? "text-2xl" : "text-lg"}`}
            >
              People and organizations surrounding this move
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold">
              {relationships.length} connected
            </span>
            <span className="flex h-9 w-9 items-center justify-center border border-white/20 text-lg">
              {expanded ? "−" : "+"}
            </span>
          </div>
        </div>
      </button>
      {expanded ? (
        <>
          <div className="grid gap-7 p-5 md:p-7 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
            <div>
              <div className="grid gap-2 md:grid-cols-2">
                {relationships.length ? (
                  relationships.map((relationship) => (
                    <div
                      key={relationship.id}
                      className="border border-[var(--app-line)] bg-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[#071421]">
                            {relationship.name}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--app-muted)]">
                            {relationship.company || "Independent contact"}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            setRelationships((current) =>
                              current.filter(
                                (item) => item.id !== relationship.id,
                              ),
                            )
                          }
                          className="text-xs text-[var(--app-muted)] hover:text-[#071421]"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="mt-3 border-t border-[var(--app-line)] pt-2 text-xs text-[#344054]">
                        {MOVE_RELATIONSHIP_ROLE_LABELS[relationship.role]} ·{" "}
                        {relationship.confidence}
                      </div>
                      {relationship.connectedAddress ? (
                        <div className="mt-1 text-xs text-[var(--app-muted)]">
                          {relationship.connectedAddress}
                        </div>
                      ) : null}
                      {(relationship.preferredChannel &&
                        relationship.preferredChannel !== "unknown") ||
                      relationship.socialHandle ? (
                        <div className="mt-1 text-xs text-[var(--app-muted)]">
                          {[
                            relationship.preferredChannel !== "unknown"
                              ? relationship.preferredChannel
                              : "",
                            relationship.socialHandle,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="border border-dashed border-[var(--app-line)] bg-[#fbfaf6] p-5 text-sm text-[var(--app-muted)] md:col-span-2">
                    No surrounding relationships connected yet. Add the realtor,
                    brokerage, building, property manager, mortgage broker or
                    another relevant person or organization.
                  </div>
                )}
              </div>
            </div>
            <div className="border border-[var(--app-line)] bg-[#fbfaf6] p-4">
              <div className="text-sm font-semibold text-[#071421]">
                Connect a relationship
              </div>
              <div className="mt-3 space-y-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <select
                    className="crm-input"
                    value={relationshipRole}
                    disabled={disabled}
                    onChange={(event) =>
                      setRelationshipRole(
                        event.target.value as MoveRelationshipRole,
                      )
                    }
                  >
                    {Object.entries(MOVE_RELATIONSHIP_ROLE_LABELS).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                  <select
                    className="crm-input"
                    value={relationshipConfidence}
                    disabled={disabled}
                    onChange={(event) =>
                      setRelationshipConfidence(
                        event.target.value as MoveRelationship["confidence"],
                      )
                    }
                  >
                    <option value="confirmed">Confirmed</option>
                    <option value="likely">Likely match</option>
                    <option value="possible">Possible — verify</option>
                  </select>
                  <label className="md:col-span-2 text-[10px] font-semibold uppercase tracking-wider text-[#5d5642]">
                    Which side of the move?
                    <select
                      className="crm-input mt-1 w-full"
                      value={addressConnection}
                      disabled={disabled}
                      onChange={(event) =>
                        setAddressConnection(
                          event.target.value as NonNullable<
                            MoveRelationship["addressConnection"]
                          >,
                        )
                      }
                    >
                      <option value="origin">
                        Origin — {lead.originAddress || "address not entered"}
                      </option>
                      <option value="destination">
                        Destination —{" "}
                        {lead.destAddress || "address not entered"}
                      </option>
                      <option value="both">Both origin and destination</option>
                      <option value="other">
                        Move-level / neither address
                      </option>
                    </select>
                  </label>
                  <select
                    className="crm-input"
                    value={preferredChannel}
                    disabled={disabled}
                    onChange={(event) =>
                      setPreferredChannel(
                        event.target
                          .value as MoveRelationship["preferredChannel"],
                      )
                    }
                  >
                    <option value="unknown">Contact mode unknown</option>
                    <option value="phone">Phone</option>
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                    <option value="instagram">Instagram</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="in_person">In person</option>
                  </select>
                  <input
                    className="crm-input"
                    value={socialHandle}
                    disabled={disabled}
                    onChange={(event) => setSocialHandle(event.target.value)}
                    placeholder="@handle or profile URL"
                  />
                  <input
                    className="crm-input md:col-span-2"
                    value={relationshipSource}
                    disabled={disabled}
                    onChange={(event) =>
                      setRelationshipSource(event.target.value)
                    }
                    placeholder="How was this connection confirmed or discovered?"
                  />
                </div>
                <PartnerReferralSelector
                  value={selectedPartner}
                  disabled={disabled}
                  onChange={setSelectedPartner}
                  defaultCategory={
                    MOVE_RELATIONSHIP_CATEGORY_BY_ROLE[relationshipRole]
                  }
                  onCreated={(partner) => addRelationship(partner)}
                />
                <button
                  type="button"
                  onClick={() => addRelationship()}
                  disabled={disabled || !selectedPartner}
                  className="crm-button-dark w-full disabled:opacity-50"
                >
                  Connect to this move
                </button>
                <div className="border-t border-[var(--app-line)] pt-3">
                  <label className="flex items-start gap-2 text-xs leading-5 text-[#344054]">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[#C99700]"
                      checked={reviewComplete}
                      disabled={disabled}
                      onChange={(event) =>
                        setReviewComplete(event.target.checked)
                      }
                    />
                    <span>
                      I reviewed the people and organizations around this move.
                      These connections are complete for now, or none could
                      reasonably be identified.
                    </span>
                  </label>
                  <input
                    className="crm-input mt-2 w-full"
                    value={reviewNote}
                    disabled={disabled}
                    onChange={(event) => setReviewNote(event.target.value)}
                    placeholder="Optional note when no relationship was identified"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-line)] bg-[#fbfaf6] px-5 py-4 md:px-7">
            <div className="text-xs text-[var(--app-muted)]">
              {message ||
                (reviewComplete
                  ? "Relationship review marked complete."
                  : "Connect the relevant people or mark the review complete.")}
            </div>
            <button
              type="button"
              onClick={() => void save()}
              disabled={disabled || saving}
              className="crm-button-dark min-w-44 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save relationships"}
            </button>
          </div>
        </>
      ) : (
        <div className="border-t border-[var(--app-line)] bg-white px-4 py-3">
          <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--app-muted)]">
            Connected network
          </div>
          <div className="mt-1 text-sm font-semibold text-[#071421]">
            {relationships.length} relationship
            {relationships.length === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </section>
  );
}
