"""Join completed paid validation receipts to fresh source evidence; no API calls or sends."""
import argparse
import collections
import json
from pathlib import Path


def rows(path):
    with path.open(encoding="utf8") as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cohort", default="artifacts/partnership-next-day-research-20261028")
    parser.add_argument("--preparation", default="artifacts/partnership-next-day-research-20261028/preparation-20261028-current")
    parser.add_argument("--output", default="artifacts/partnership-next-day-research-20261028/completed-validation-review-20261028")
    args = parser.parse_args()
    cohort, preparation, output = map(Path, (args.cohort, args.preparation, args.output))
    if output.exists():
        raise SystemExit("Output already exists; use a new snapshot path")
    prepared = {row["organisation_id"]: row for row in rows(preparation / "preparation-work.jsonl")}
    source = {row["organisation_id"]: row for row in rows(preparation / "source-refresh.jsonl")}
    queue, holds = [], []
    seen = set()
    complete = []
    for manifest in sorted(cohort.glob("verification-*/verification-manifest.json")):
        batch = manifest.parent
        report = json.loads(manifest.read_text())
        if report.get("selected") != report.get("provider_receipts") or report.get("validation_errors") != 0:
            continue
        complete.append(batch.name)
        for row in rows(batch / "role-inclusive-review.jsonl"):
            key = (row["organisation_id"], row["email"].lower())
            if key in seen:
                raise ValueError(f"Duplicate completed validation identity: {key[0]}")
            seen.add(key)
            prior = prepared.get(row["organisation_id"])
            observation = source.get(row["organisation_id"])
            if prior is None or observation is None:
                raise ValueError("Completed receipt lacks fresh preparation or source observation")
            technical = row["technical_screen_status"] == "advance_to_identity_and_eligibility_review"
            source_bound = prior["stage"] == "awaiting_mailbox_and_individual_review"
            item = {
                "organisation_id": row["organisation_id"], "organisation_name": row["organisation_name"],
                "email": row["email"], "city": row["city"], "sector": row["sector"],
                "batch": batch.name, "technical_screen_status": row["technical_screen_status"],
                "source_stage": prior["stage"], "blockers": prior["blockers"],
                "source_urls": [p["final_url"] for p in observation["pages"] if p.get("target_email_observed") and p.get("final_url")],
                "next_checks": ["individual organization, role and geographic fit", "live CRM history and suppression", "mailbox history and consent context"],
                "campaign_ready": False, "send_authorized": False,
            }
            (queue if technical and source_bound else holds).append(item)
    output.mkdir(parents=True)
    for name, values in (("individual-review.jsonl", queue), ("held-review.jsonl", holds)):
        (output / name).write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in values))
    summary = {
        "completed_batches": complete, "completed_receipts": len(seen),
        "individual_review_queue": len(queue), "held_for_source_or_mailbox_review": len(holds),
        "hold_reasons": dict(collections.Counter(reason for item in holds for reason in ([item["technical_screen_status"]] if item["technical_screen_status"] != "advance_to_identity_and_eligibility_review" else []) + item["blockers"] + ([item["source_stage"]] if item["source_stage"] != "awaiting_mailbox_and_individual_review" else []))),
        "campaign_ready": 0, "sent": 0, "paid_validation_requests": 0,
        "limitations": ["Technical mailbox result is not authorization to contact.", "Fresh source binding is not proof of organizational fit, role, consent or inbox placement.", "Unfinished batches and sandbox DNS errors are excluded; their reserved attempts require separate reconciliation."],
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({k: v for k, v in summary.items() if k != "completed_batches"}, indent=2))


if __name__ == "__main__":
    main()
