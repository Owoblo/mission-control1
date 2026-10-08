"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  handoffIsOverdue,
  type PartnerSalesHandoff,
} from "@/lib/partner-sales-handoff";
type Row = {
  id: string;
  name: string;
  summary: string;
  owner: string;
  status: string;
  brief: PartnerSalesHandoff;
};
export default function PartnerOpportunities() {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/sales/partner-opportunities")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setRows(d.leads);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold">Partnership Sales opportunities</h1>
      <p className="mt-2 text-sm text-slate-600">
        Reviewed jobs with conversation context, an owner and a next action.
        Open an opportunity to accept it or record progress.
      </p>
      <Link
        className="my-3 inline-block text-blue-700 underline"
        href="/sales/tasks"
      >
        My follow-up tasks
      </Link>
      {error && <p role="alert">{error}</p>}
      {!loaded && <p>Loading…</p>}
      {loaded && !error && !rows.length && <p>No reviewed handoffs yet.</p>}
      <div className="grid gap-4">
        {rows
          .slice()
          .sort(
            (a, b) =>
              Number(a.status === "completed") -
                Number(b.status === "completed") ||
              Date.parse(a.brief.dueAt) - Date.parse(b.brief.dueAt),
          )
          .map((r) => (
            <Link
              href={`/sales/leads/${encodeURIComponent(r.id)}`}
              key={r.id}
              className="block rounded-xl border bg-white p-4 hover:border-sky-500"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h2 className="font-bold">{r.name}</h2>
                <span
                  className={
                    handoffIsOverdue(r.brief, r.status)
                      ? "text-red-700"
                      : "text-slate-500"
                  }
                >
                  {r.status === "completed"
                    ? "Completed"
                    : handoffIsOverdue(r.brief, r.status)
                      ? "Overdue"
                      : r.brief.acceptedAt
                        ? "Accepted"
                        : "Awaiting acceptance"}
                </span>
              </div>
              <p className="my-2">{r.summary}</p>
              <p className="text-sm">
                <strong>Next:</strong> {r.brief.nextAction}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {r.owner} · Follow up by{" "}
                {new Date(r.brief.dueAt).toLocaleString()}
              </p>
              {r.brief.outcome && (
                <p className="mt-2 text-sm">Latest: {r.brief.outcome}</p>
              )}
            </Link>
          ))}
      </div>
    </main>
  );
}
