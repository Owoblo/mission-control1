"""Read-only reconciliation of saved research; never authorizes or sends email.

Snapshots the currently appended source-refresh file once. A partial final line
is counted and skipped, while malformed complete lines fail the run. Re-run as
source workers advance. Publication/technical checks are NOT send eligibility.
"""
import argparse
import collections
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def reconcile(root):
    inputs = {}
    partial_lines = []

    def read(name, lines=False):
        data = (root / name).read_bytes()
        inputs[name] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
        if not lines:
            return json.loads(data)
        result = []
        for index, line in enumerate(data.splitlines(keepends=True)):
            if not line.strip():
                continue
            try:
                result.append(json.loads(line))
            except (json.JSONDecodeError, UnicodeDecodeError):
                if not line.endswith(b"\n") and index == len(data.splitlines()) - 1:
                    partial_lines.append({"file": name, "line": index + 1})
                else:
                    raise
        return result

    def indexed(name):
        result = {}
        for row in read(name, lines=True):
            result[(row["organisation_id"], row["email"].lower())] = row
        return result

    candidates = read("candidates.json")
    technical = indexed("role-inclusive-review.jsonl")
    audit = indexed("candidate-audit-records.jsonl")
    priority = indexed("candidate-audit-priority-holds.jsonl")
    refreshed = indexed("source-refresh.jsonl")
    context_data = read("account-context-review.json")
    context = {(r["organisation_id"], r["email"].lower()): r for r in context_data["findings"]}
    history = [read("mailbox-history-saturn.json"), read("mailbox-history-ottawa.json")]
    history_matches = collections.defaultdict(list)
    for market in history:
        for match in market.get("matches", []):
            history_matches[match["email"].lower()].append({"market": market["market"], "messages": len(match["messages"])})
    history_complete = all(h.get("complete") is True for h in history)
    manual = {(r["organisation_id"], r["candidate_email"].lower()): r for r in read("source-review-first-10.json")}
    practical = indexed("practical-fit-source-review-20.jsonl") if (root / "practical-fit-source-review-20.jsonl").exists() else {}
    global_unfinished = [
        "approved_exact_message_and_source_eligibility_review_required",
        "live_suppression_context_and_policy_reservation_required",
        "prepared_sender_deployment_and_reply_delivery_roundtrip_required",
    ]
    rows = []
    for candidate in candidates:
        key = candidate["organisation_id"], candidate["email"].lower()
        tech, saved, fresh, ctx, exclusion, reviewed = (mapping.get(key, {}) for mapping in (technical, audit, refreshed, context, priority, manual))
        reasons = []
        if tech.get("technical_screen_status") != "advance_to_identity_and_eligibility_review":
            reasons.append("technical_mailbox_review")
        if not fresh:
            reasons.append("fresh_source_check_pending")
        elif not fresh.get("target_email_observed"):
            reasons.append("selected_email_not_reobserved_in_limited_source_check")
        if fresh.get("restriction_signals"):
            reasons.append("publication_restriction_signal_review")
        flags = saved.get("flags", [])
        reasons.extend(flags)
        if exclusion:
            reasons.append("priority_identity_exclusion")
        if not ctx or not context_data.get("crm_complete"):
            reasons.append("saved_crm_scan_incomplete")
        if ctx.get("matched_contacts"):
            reasons.append("existing_account_context_review")
        if not context_data.get("ses_suppression_complete"):
            reasons.append("saved_ses_suppression_scan_incomplete")
        if ctx.get("ses_suppression_reason"):
            reasons.append("ses_suppressed")
        if not history_complete:
            reasons.append("saved_mailbox_history_scan_incomplete")
        if history_matches[key[1]]:
            reasons.append("prior_mailbox_conversation_review")
        manual_disposition = reviewed.get("source_claims", {}).get("disposition", "")
        if manual_disposition.startswith("hold"):
            reasons.append(manual_disposition)
        practical_review = practical.get(key, {})
        if practical_review.get("identity_email_binding") == "hold":
            reasons.append("practical_review_identity_hold")
        if practical_review.get("role_relevance") == "hold":
            reasons.append("practical_review_relevance_hold")
        reasons = sorted(set(reasons))
        rows.append({
            "organisation_id": key[0], "organisation_name": candidate["organisation_name"],
            "city": candidate["city"], "sector": candidate["sector"], "email": candidate["email"],
            "domain": candidate["domain"], "source_url": candidate.get("email_source_url"),
            "technical_screen": tech.get("technical_screen_status", "missing"),
            "mailbox_assessment": tech.get("mailbox_assessment", "missing"),
            "fresh_source_checked_at": fresh.get("checked_at"),
            "email_reobserved": fresh.get("target_email_observed") if fresh else None,
            "restriction_signal_count": len(fresh.get("restriction_signals", [])),
            "saved_identity_flags": flags,
            "priority_exclusion_reason": exclusion.get("review_reason"),
            "crm_match_count": len(ctx.get("matched_contacts", [])),
            "mailbox_history_matches": history_matches[key[1]],
            "manual_source_disposition": manual_disposition,
            "practical_identity_review": practical_review.get("identity_email_binding", "not_reviewed"),
            "practical_role_relevance": practical_review.get("role_relevance", "not_reviewed"),
            "practical_required_correction": practical_review.get("required_correction_or_action"),
            "specific_unresolved_reasons": reasons,
            "global_unfinished_steps": global_unfinished,
            "review_priority": "best_next_manual_review" if not reasons else "resolve_specific_findings",
            "role_address_alone_is_hold": False,
            "campaign_ready": False,
            "send_status": "not_authorized_by_this_research_snapshot",
        })
    summary = {
        "at": datetime.now(timezone.utc).isoformat(),
        "candidates": len(rows),
        "technical_screen_advance": sum(r["technical_screen"] == "advance_to_identity_and_eligibility_review" for r in rows),
        "technical_screen_review": sum(r["technical_screen"] != "advance_to_identity_and_eligibility_review" for r in rows),
        "fresh_source_checked": sum(r["fresh_source_checked_at"] is not None for r in rows),
        "fresh_source_remaining": sum(r["fresh_source_checked_at"] is None for r in rows),
        "email_reobserved": sum(r["email_reobserved"] is True for r in rows),
        "restriction_signal_candidates": sum(r["restriction_signal_count"] > 0 for r in rows),
        "priority_exclusion_candidates": sum(bool(r["priority_exclusion_reason"]) for r in rows),
        "existing_crm_context_candidates": sum(r["crm_match_count"] > 0 for r in rows),
        "prior_mailbox_conversation_candidates": sum(bool(r["mailbox_history_matches"]) for r in rows),
        "best_next_manual_review_candidates": sum(r["review_priority"] == "best_next_manual_review" for r in rows),
        "specific_unresolved_reason_counts": dict(collections.Counter(reason for r in rows for reason in r["specific_unresolved_reasons"])),
        "global_unfinished_steps": global_unfinished,
        "campaign_ready": 0,
        "live_queue_sent_delivered_counts": "not_queried_by_this_read_only_reconciliation",
        "limitations": [
            "Best next manual review is a prioritization, not an approval or eligibility decision.",
            "Fresh source review inspects at most four pages; missing observation does not establish invalidity.",
            "Restriction signals require context; a phrase match is not itself an established prohibition.",
            "Mailbox technical confidence and publication do not establish business binding, suitability or permission.",
            "Exact-email mailbox scans do not exhaust account/domain relationships; live checks remain necessary.",
            "Saved review flags are not silently cleared by a fresh email string observation.",
        ],
        "input_snapshots": inputs,
        "partial_appended_lines_skipped": partial_lines,
    }
    (root / "launch-readiness-reconciled.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
    with (root / "launch-readiness-reconciled.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        for row in rows:
            writer.writerow({key: json.dumps(value) if isinstance(value, (list, dict)) else value for key, value in row.items()})
    (root / "launch-readiness-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (root / "next-manual-review-candidates.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows if row["review_priority"] == "best_next_manual_review"))
    print(json.dumps({k: v for k, v in summary.items() if k not in ("input_snapshots", "limitations")}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("artifacts/partnership-pilot-3000-20261027"))
    reconcile(parser.parse_args().root)
