import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(
  `create role anon; create role authenticated; create role service_role; create table market_contacts(id text primary key,do_not_contact boolean, cross_channel_suppressed_at timestamptz,sequence_paused boolean,sequence_paused_reason text);create table market_touches(id text primary key,contact_id text,created_at timestamptz);create table crm_leads(id text primary key,data jsonb,deleted boolean,updated_at timestamptz);`,
);
const root = new URL("../../", import.meta.url).pathname;
await db.exec(
  fs.readFileSync(
    root + "supabase/migrations/20260811130000_crm_tasks.sql",
    "utf8",
  ),
);
await db.exec(
  fs.readFileSync(
    root +
      "supabase/migrations/20261008001000_reviewed_partner_sales_handoff.sql",
    "utf8",
  ),
);
await db.exec(`set role authenticated;`);
await assert.rejects(
  () =>
    db.query("select create_reviewed_partner_handoff($1,$2,$3,$4)", [
      "c",
      "{}",
      "{}",
      false,
    ]),
  /permission denied/,
);
await db.exec("reset role");
await db.exec(
  `insert into market_contacts(id) values ('c');insert into market_touches values ('t','c',now());`,
);
const lead = {
  id: "partner-handoff-c-t",
  name: "Partner",
  partnerReferralContactId: "c",
  partnerHandoff: {
    sourceTouchId: "t",
    reviewedThroughTouchId: "t",
    summary: "Sofa swap",
    nextAction: "Call tomorrow",
    callbackPermission: "Tomorrow only",
    dueAt: "2026-10-09T14:00:00Z",
  },
  notes: "Original",
  stage: "new",
};
const task = {
  id: "handoff-task-" + lead.id,
  title: "Call",
  due_at: "2026-10-09T14:00:00Z",
};
const create = (l = lead, separate = false) =>
  db.query("select create_reviewed_partner_handoff($1,$2,$3,$4)", [
    "c",
    JSON.stringify(l),
    JSON.stringify(task),
    separate,
  ]);
await create();
assert.equal((await db.query('select data from crm_leads')).rows[0].data.automationStatus, 'handoff');
await create();
assert.equal((await db.query("select * from crm_leads")).rows.length, 1);
assert.equal((await db.query("select * from crm_tasks")).rows.length, 1);
await db.exec(
  `update crm_leads set data=data || '{"stage":"qualified","notes":"Sales notes"}'::jsonb;`,
);
await create();
assert.equal(
  (await db.query("select data from crm_leads")).rows[0].data.stage,
  "qualified",
);
await db.query("select update_reviewed_partner_handoff($1,$2,$3,$4,$5)", [
  lead.id,
  JSON.stringify(lead.partnerHandoff),
  JSON.stringify({
    ...lead.partnerHandoff,
    outcome: "Spoke",
    acceptedBy: "Rep",
  }),
  "in_progress",
  "Rep",
]);
assert.equal(
  (await db.query("select data from crm_leads")).rows[0].data.notes,
  "Sales notes",
);
await assert.rejects(
  () =>
    db.query("select update_reviewed_partner_handoff($1,$2,$3,$4,$5)", [
      lead.id,
      JSON.stringify(lead.partnerHandoff),
      "{}",
      "completed",
      "Rep",
    ]),
  /changed/,
);
await db.exec(
  `insert into market_touches values ('t2','c',now()+interval '1 minute');`,
);
const repeat = {
  ...lead,
  id: "partner-handoff-c-t2",
  partnerHandoff: {
    ...lead.partnerHandoff,
    sourceTouchId: "t2",
    reviewedThroughTouchId: "t2",
  },
};
await assert.rejects(() => create(repeat), /separate job/);
const repeatTask = { ...task, id: "handoff-task-" + repeat.id };
await db.query("select create_reviewed_partner_handoff($1,$2,$3,$4)", [
  "c",
  JSON.stringify(repeat),
  JSON.stringify(repeatTask),
  true,
]);
assert.equal((await db.query("select * from crm_leads")).rows.length, 2);
await db.exec(
  `update crm_leads set deleted=true where id='partner-handoff-c-t';`,
);
await assert.rejects(() => create(), /deleted/);
await db.exec(
  `insert into market_touches values ('t3','c',now()+interval '2 minutes');`,
);
const stale = {
  ...lead,
  id: "partner-handoff-c-t3",
  partnerHandoff: {
    ...lead.partnerHandoff,
    sourceTouchId: "t3",
    reviewedThroughTouchId: "t2",
  },
};
await assert.rejects(() => create(stale, true), /Conversation changed/);
await db.exec(`update market_contacts set do_not_contact=true;`);
await assert.rejects(() => create(), /suppressed/);
console.log(
  "PASS: atomic creation/task, retry idempotency, preserve Sales work, stale update rejection, separate jobs, deleted and suppressed protection",
);
await db.close();
