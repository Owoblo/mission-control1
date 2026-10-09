import { test } from "node:test";
import assert from "node:assert/strict";
import {
  phoneKey,
  latestPartnerMessage,
  deduplicateEvents,
  responseKind,
  responseSummary,
  campaignWindow,
  salesOwnership,
  referralOutcomes,
  type ContextEvent,
} from "../../lib/partner-context";
const event = (extra: Partial<ContextEvent> = {}): ContextEvent => ({
  id: "1",
  source: "Partnerships",
  sourceId: "1",
  at: "2026-10-09T16:00:00Z",
  channel: "sms",
  direction: "inbound",
  text: "hello",
  audience: "partner",
  person: "Same Name",
  personId: "p1",
  ...extra,
});
test("phone identity normalizes NANP and refuses missing/foreign identities", () => {
  assert.equal(phoneKey("(416) 555-1234"), "14165551234");
  assert.equal(phoneKey("+14165551234"), "14165551234");
  assert.equal(phoneKey(""), "");
  assert.equal(phoneKey("+442071234567"), "");
});
test("one provider event keeps recording, direction and status; identical text from distinct events survives", () => {
  const rows = deduplicateEvents([
    event({ providerId: "telnyx:abc" }),
    event({
      id: "2",
      source: "Sales SMS",
      providerId: "abc",
      status: "delivered",
    }),
    event({ id: "3", sourceId: "3", providerId: "xyz" }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "delivered");
  const calls = deduplicateEvents([
    event({
      channel: "phone",
      providerId: "CA1",
      playback: "/recording",
      text: "Short",
    }),
    event({
      channel: "phone",
      providerId: "CA1",
      text: "Long transcript",
      direction: "recorded",
    }),
  ]);
  assert.equal(calls[0].playback, "/recording");
  assert.equal(calls[0].text, "Long transcript");
  assert.equal(calls[0].direction, "inbound");
});
test("responses use identity, not matching names; clients and outgoing messages are excluded", () => {
  const r = responseSummary([
    event({ text: "Liked “Hello”" }),
    event({ id: "2", personId: "p2", text: "My client moves next month" }),
    event({ id: "3", personId: "p3", audience: "client" }),
    event({ id: "4", personId: "p4", direction: "outbound" }),
  ]);
  assert.equal(r.respondents, 2);
  assert.equal(r.substantive, 1);
  assert.equal(r.reactionOnly, 1);
  assert.equal(responseKind("Automatic reply: away today"), "automated");
  assert.equal(responseKind("STOP"), "opt_out");
  assert.equal(responseKind("Please stop by our office"), "substantive");
});
test("sales ownership requires accepted, assigned handoff and yields when any handoff returns to Partnerships", () => {
  const base = {
    id: "h1",
    data: {
      partnerReferralContactId: "p1",
      assignedRepUserId: "r",
      assignedRepName: "Thelma",
      handoffStatus: "in_progress",
      partnerHandoff: { acceptedAt: "2026-10-09" },
    },
  };
  assert.equal(salesOwnership([base]).get("p1")?.owner, "Thelma");
  assert.equal(
    salesOwnership([{ ...base, data: { ...base.data, partnerHandoff: {} } }])
      .size,
    0,
  );
  assert.equal(
    salesOwnership([
      base,
      {
        id: "h2",
        data: {
          partnerReferralContactId: "p1",
          handoffStatus: "needs_partner_follow_up",
        },
      },
    ]).size,
    0,
  );
  assert.equal(
    salesOwnership([
      { ...base, data: { ...base.data, handoffStatus: "completed" } },
    ]).size,
    0,
  );
});
test("referral channels and client moves do not double count bookings; repeated ledger rows dedupe by lead", () => {
  const rows = [
    { id: "handoff", role: "partner", hasHandoff: true, stage: "booked" },
    { id: "client", stage: "booked" },
    { id: "client", stage: "booked" },
    { id: "own", role: "customer", hasHandoff: true, stage: "quoted" },
    { id: "unknown", hasHandoff: true, stage: "new" },
  ];
  const r = referralOutcomes(rows);
  assert.equal(r.referralChannels, 1);
  assert.equal(r.movingOpportunities, 2);
  assert.equal(r.booked, 1);
  assert.equal(r.quoted, 1);
  assert.equal(r.linkedRecords, 4);
});
test("execution cutoff respects Toronto fractional hours, same day, DST and invalid windows", () => {
  const config = { timezone: "America/Toronto", startHour: 10, endHour: 17.5 };
  const scheduled = "2026-10-09T18:00:00Z";
  assert.equal(
    campaignWindow(config, scheduled, new Date("2026-10-09T21:29:59Z")).allowed,
    true,
  );
  assert.equal(
    campaignWindow(config, scheduled, new Date("2026-10-09T21:30:00Z")).reason,
    "campaign_window_closed",
  );
  assert.equal(
    campaignWindow(config, scheduled, new Date("2026-10-10T15:00:00Z")).reason,
    "campaign_day_expired",
  );
  assert.equal(
    campaignWindow(config, scheduled, new Date("2026-10-09T13:59:00Z")).reason,
    "campaign_window_not_open",
  );
  assert.equal(
    campaignWindow(
      config,
      "2026-11-03T15:00:00Z",
      new Date("2026-11-03T22:30:00Z"),
    ).reason,
    "campaign_window_closed",
  );
  for (const notes of [
    "bad json",
    { startHour: 22, endHour: 21 },
    { endHour: 25 },
    { timezone: "bad/zone" },
  ])
    assert.equal(
      campaignWindow(notes, scheduled, new Date(scheduled)).reason,
      "invalid_campaign_window",
    );
});

test("failed sends and delivery events cannot clear an unanswered message", () => {
  const inbound = event();
  const failed = event({
    id: "2",
    direction: "outbound",
    status: "failed",
    at: "2026-10-09T17:00:00Z",
  });
  assert.equal(
    latestPartnerMessage([
      inbound,
      failed,
      event({ id: "3", direction: "system", at: "2026-10-09T18:00:00Z" }),
    ])?.id,
    "1",
  );
  assert.equal(
    latestPartnerMessage([inbound, { ...failed, status: "delivered" }])?.id,
    "2",
  );
});
