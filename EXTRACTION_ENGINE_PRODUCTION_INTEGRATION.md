# Production integration readiness — 2026-11-12

The source integration candidate passes **400 guarded offline tests** and actual OS-process recovery checks. Existing extraction predictions are unchanged. **Production has not been updated or restarted.** The live-release decision remains NO_GO; no gate, CRM hold, source restriction or outreach permission was weakened.

## Work completed

- Added `staging/extraction-evaluation/prepare_production_candidate.py`. It combines a read-only production deployment-source baseline with the hash-verified staging snapshot into a new, separate directory. It rejects existing/overlapping output destinations, corrupt snapshots, escaped/symlinked paths and attempts to replace the production entrypoint.
- Added `staging/extraction-evaluation/check_candidate.py`. It loads the 394 cumulative regression tests against the combined candidate, plus three existing dashboard/restore tests and three new candidate-builder tests, under the offline I/O guard.
- Added `tests/extraction/test_production_candidate.py`: unchanged baseline/entrypoint, excluded customer database/deployment configuration, tampered hashes, traversal, symlink and entrypoint-overlay regressions.
- Created `.runtime/extraction-production-candidate-20261112`, containing 367 source/test/assets files from 233 baseline source files plus the tested overlay. `integration-manifest.json` records every before/after hash. All baseline files remained byte-identical when checked after testing.

The candidate deliberately omits Docker/startup configuration, handoff/seed inputs, credentials and customer databases. It is an **offline compatibility candidate, not a deployable production artifact**. No production database was opened or migrated. Its underlying deployment-source baseline is the saved local deployment context; this is not proof of the running container's complete filesystem identity.

## Actual results

| Check | Result |
|---|---|
| Combined-source guarded suite | 400 passed in 6.640 seconds; zero unexpected guard violations |
| Shared host budget with three OS processes | Exactly two injected HTTP requests; peak concurrency one |
| Killed host-owner recovery | Passed; consumed reservation retained |
| Actual bounded workers | Email, phone and context checkpoint recovery passed |
| Persistence interruptions | All 12 spool/commit/ack/acknowledged cases passed |
| Frozen 17-capture replay | Zero prediction changes; pre-existing unsupported Unicode email miss remains |
| Extended 18-capture replay | Zero prediction changes; zero scored errors |
| Original deployment source | 233 source hashes unchanged |
| Production entrypoint | Preserved byte-for-byte |

Process tests used macOS sandbox-exec with OS networking denied and injected HTTP/DNS responses. The cumulative suite used its Python audit guard. Tests used disposable SQLite databases, not production stores. This turn did not perform a new Linux container run or claim that dashboard health proves extraction correctness.

Commands:

```sh
python3 -B staging/extraction-evaluation/prepare_production_candidate.py \
  --baseline .runtime/railway-research/deploy \
  --snapshot .runtime/extraction-staging/final \
  --output .runtime/extraction-production-candidate-20261112
python3 -B staging/extraction-evaluation/check_candidate.py \
  --candidate .runtime/extraction-production-candidate-20261112
TMPDIR=/tmp python3 -B .runtime/extraction-production-candidate-20261112/tests/extraction/pr17_measure.py \
  --output /tmp/extraction-production-candidate-accuracy-20261112
TMPDIR=/tmp python3 -B .runtime/extraction-production-candidate-20261112/tests/extraction/run_corrective_processes.py \
  --output /tmp/extraction-production-candidate-processes-20261112
```

For reruns, use new output destinations; never overwrite an existing candidate or result directory.

Evidence: `tests/extraction/production_integration_results/{summary.json,tests.log,process-results.json,integration-manifest.json,frozen.json,extended.json,release-evaluation.json,workload.json}`.

## Corrections to the earlier preflight interpretation

The 32 missing and 16 differing files previously reported were differences between the saved deployment-source package and the tested extraction snapshot. They were **not 48 demonstrated defects**, and did not independently prove that production would break. The source overlay now reconciles those packaging differences in a disposable candidate. Runtime configuration, startup side effects, migration and source-policy compatibility remain separate checks.

## Remaining release checklist

| Requirement | Evidence needed / next action | Current state |
|---|---|---|
| Representative real corpus | Owner/designated reviewer approves specific captures and retention rights; independent reviewers annotate and adjudicate; freeze domain/template-separated holdout | Blocked on approval and labels |
| Accuracy and ownership gates | Run unchanged PR-17 thresholds against approved holdout and adversarial safety set; do not substitute synthetic scores | Not established |
| Generic host budgets | Review and provision one persistent shared root for participating coordinators; validate bounded policy and existing Retry-After behavior on a disposable deployment | Not configured by this work |
| Capture reuse rights | Versioned source policy, current authorization, retention deadlines and preservation requirements; missing evidence must keep reuse disabled | Source-specific review needed |
| Production startup integration | Check every enabled worker path against an exact production image and disposable restored bundle; preserve unrelated listing/investor workflows | Not yet validated end-to-end |
| Migration and rollback | Explicit queue/schema inventory, backup of authorized stores, disposable restore, additive migration rehearsal and rollback compatibility | Generic fixture coverage passed; real deployment inventory not certified |
| Runtime environment | Re-run combined compatibility tests in the exact production Python/dependency image; retain resolved image digest | Local combined-source checks passed; prior standalone Linux staging passed |
| Bounded rollout | After gates pass, use reviewed source allowlist, explicit request cap, zero outreach and retained source evidence; inspect attribution before broader activation | Not enabled |

The production entrypoint copies code into a persistent root and can start multiple unrelated workflows. Replacing the live image merely to demonstrate a deployment would restart those workflows and would not establish extraction accuracy. This candidate therefore preserves the existing service until the remaining checks have evidence.

## Capture-review handoff

The existing November 11 read-only inventory reports 3,397 source-bearing files, of which 1,693 have matching receipt hashes; **zero were admitted to PR-17**. These are saved inventory counts, not a fresh scan or permission determination. A matching hash alone does not establish source rights, original HTTP provenance, independent labels or representativeness.

Use `tests/extraction/corrections_results/corpus-review.csv` and `tests/extraction/CAPTURE_LABELING_WORKFLOW.md`. They already contain the review fields; no approval, label, retention date or ownership truth was invented. The owner/designated reviewer must identify evaluation/retention permission and independent annotators. Engineering can then validate schema, hashes, splits and the unchanged release gates.

## Rollback

There is no live change to roll back. Remove only this task's disposable candidate if no longer needed. Revert only the three new integration-tool/test files if abandoning the tooling; preserve all earlier extraction code and unrelated uncommitted work. Results are separate from prior audit/staging evidence. No database rollback or CRM-state operation is required.
