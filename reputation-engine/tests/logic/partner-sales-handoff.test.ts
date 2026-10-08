import test from "node:test";
import assert from "node:assert/strict";
import {
  currentHandoffCandidates,
  validateHandoffBrief,
  handoffIsOverdue,
  type HandoffTouch,
  type PartnerSalesHandoff,
} from "../../lib/partner-sales-handoff";
import { partnershipCallNeedsFallback } from "../../lib/partner-call-fallback";
const now = Date.parse("2026-10-08T00:00:00Z");
const t = (id: string, notes: string, age: number): HandoffTouch => ({
  id,
  notes,
  contact_id: "partner",
  direction: "inbound",
  channel: "sms",
  created_at: new Date(now - age).toISOString(),
});
const detect = (s: string | null) => ({ is_lead: !!s?.includes("sofa") });
test("a thank you does not erase a concrete enquiry; a later closure does", () => {
  assert.equal(
    currentHandoffCandidates(
      [t("2", "Thanks", 1), t("1", "Move sofa", 2)],
      detect,
      now,
    )[0].id,
    "1",
  );
  assert.equal(
    currentHandoffCandidates(
      [t("2", "Already booked movers", 1), t("1", "Move sofa", 2)],
      detect,
      now,
    ).length,
    0,
  );
  assert.equal(
    currentHandoffCandidates([t("1", "Move sofa", 8 * 86400000)], detect, now)
      .length,
    0,
  );
});
test("a new job after an older closure remains reviewable", () =>
  assert.equal(
    currentHandoffCandidates(
      [t("2", "Move sofa", 1), t("1", "already found someone", 2)],
      detect,
      now,
    ).length,
    1,
  ));
test("review requires explicit role, source, summary and future due time", () => {
  const b = {
    summary: "Swap sofas",
    knownDetails: "Two addresses",
    missingDetails: "Date",
    johnContext: "Promised Thursday call",
    nextAction: "Call Thursday",
    callbackPermission: "Thursday only",
    dueAt: "2026-10-08T14:00:00Z",
    sourceTouchId: "1",
    reviewedThroughTouchId: "2",
    primaryContactRole: "customer",
  };
  assert.equal(
    validateHandoffBrief(b, new Date(now)).callbackPermission,
    "Thursday only",
  );
  assert.throws(() =>
    validateHandoffBrief(
      { ...b, primaryContactRole: "unknown" },
      new Date(now),
    ),
  );
  assert.throws(() =>
    validateHandoffBrief({ ...b, callbackPermission: "" }, new Date(now)),
  );
  assert.throws(() =>
    validateHandoffBrief({ ...b, dueAt: "2020-01-01" }, new Date(now)),
  );
  assert.equal(
    handoffIsOverdue(
      { dueAt: "2020-01-01" } as PartnerSalesHandoff,
      "completed",
      now,
    ),
    false,
  );
});
test("fallback only follows failed inbound Dial attempt, once", () => {
  for (const dialStatus of ["no-answer", "busy", "failed", "canceled"])
    assert.equal(
      partnershipCallNeedsFallback({
        dialStatus,
        direction: "inbound",
        alreadyFallback: false,
      }),
      true,
    );
  for (const dialStatus of ["completed", "ringing", "in-progress", ""])
    assert.equal(
      partnershipCallNeedsFallback({
        dialStatus,
        direction: "inbound",
        alreadyFallback: false,
      }),
      false,
    );
  assert.equal(
    partnershipCallNeedsFallback({
      dialStatus: "no-answer",
      direction: "outbound-api",
      alreadyFallback: false,
    }),
    false,
  );
  assert.equal(
    partnershipCallNeedsFallback({
      dialStatus: "no-answer",
      direction: "inbound",
      alreadyFallback: true,
    }),
    false,
  );
});

// A partner phone identifies a relationship, not a unique customer job.
import { findLeadIdentityMatches } from "../../lib/server/lead-identity";
test("automatic identity matching cannot collapse separate partner jobs", () => {
  const rows = [
    {
      id: "partner-handoff-c-t1",
      name: "Partner",
      stage: "new" as const,
      phone: "+14165550100",
    },
    {
      id: "partner-handoff-c-t2",
      name: "Partner",
      stage: "new" as const,
      phone: "+14165550100",
    },
  ];
  assert.deepEqual(
    findLeadIdentityMatches(rows, { phone: "+14165550100" }),
    [],
  );
  assert.equal(
    findLeadIdentityMatches([{ ...rows[0], id: "customer" }], {
      phone: "+14165550100",
    }).length,
    1,
  );
});

import { hasSeparateLeadIdentity } from "../../lib/server/lead-identity";
import { buildSmsThreads } from "../../lib/server/sms-threads";
import type { CRMLead } from "../../lib/types";
test("separate opportunities are isolated for both merge and deletion decisions", () => {
  assert.equal(hasSeparateLeadIdentity({ id: "partner-handoff-c-job" }), true);
  assert.equal(
    hasSeparateLeadIdentity({ id: "child", parentLeadId: "parent" }),
    true,
  );
  assert.equal(hasSeparateLeadIdentity({ id: "customer" }), false);
});
test("SMS from a repeat partner presents job choices instead of choosing one arbitrarily", () => {
  const leads = [
    {
      id: "partner-handoff-c-a",
      name: "Realtor",
      stage: "new",
      phone: "+14165550100",
      handoffStatus: "new",
      partnerLeadSummary: "First job",
    },
    {
      id: "partner-handoff-c-b",
      name: "Realtor",
      stage: "new",
      phone: "+14165550100",
      handoffStatus: "new",
      partnerLeadSummary: "Second job",
    },
  ] as CRMLead[];
  const threads = buildSmsThreads(
    [
      {
        id: "m",
        from_number: "+14165550100",
        to_number: "+14374650584",
        body: "About my client",
        direction: "inbound",
        lead_id: leads[0].id,
        twilio_sid: "SMfixture",
        created_at: "2026-10-08T00:00:00Z",
      },
    ],
    leads,
    [],
    false,
  );
  assert.equal(threads[0].leadId, null);
  assert.equal(threads[0].partnerOpportunities?.length, 2);
});
