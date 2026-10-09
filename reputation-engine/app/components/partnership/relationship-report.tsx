"use client";
import { useState } from "react";
type Report = {
  since: string;
  through: string;
  complete: boolean;
  outboundPeople: number;
  engagement: {
    respondents: number;
    substantive: number;
    reactionOnly: number;
    automatedOnly: number;
    acknowledgementOnly: number;
    optOut: number;
  };
  outcomes: {
    referralChannels: number;
    movingOpportunities: number;
    quoted: number;
    booked: number;
    completed: number;
  };
  definition: string;
};
export function RelationshipReport() {
  const [data, setData] = useState<Report | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(days: number) {
    setBusy(true);
    setError("");
    setData(null);
    try {
      const r = await fetch(`/api/marketing/relationship-report?days=${days}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="my-2 rounded border border-slate-200 p-2 text-xs">
      <summary className="cursor-pointer font-semibold">
        Response &amp; referral report
      </summary>
      <div className="my-2 flex gap-3">
        <button disabled={busy} onClick={() => load(1)}>
          Last 24 hours
        </button>
        <button disabled={busy} onClick={() => load(14)}>
          Last 14 days
        </button>
      </div>
      {busy && <p>Checking activity…</p>}
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            {new Date(data.since).toLocaleString()} –{" "}
            {new Date(data.through).toLocaleString()}
          </p>
          {!data.complete && (
            <p role="alert">
              Partial report: the history limit was reached. Counts are
              incomplete.
            </p>
          )}
          <p className="my-2">
            {data.outboundPeople} people texted · {data.engagement.respondents}{" "}
            respondents · {data.engagement.substantive} substantive ·{" "}
            {data.engagement.reactionOnly} reaction only ·{" "}
            {data.engagement.automatedOnly} automatic only ·{" "}
            {data.engagement.acknowledgementOnly} acknowledgement only ·{" "}
            {data.engagement.optOut} opt-outs
          </p>
          <p>
            {data.outcomes.referralChannels} referral channels ·{" "}
            {data.outcomes.movingOpportunities} moving opportunities ·{" "}
            {data.outcomes.quoted} quoted · {data.outcomes.booked} booked or
            later · {data.outcomes.completed} completed
          </p>
          <p className="mt-2 text-slate-500">
            {data.definition} Opt-outs can overlap earlier substantive replies.
            Accepted sends are not confirmed delivery.
          </p>
        </>
      )}
    </details>
  );
}
