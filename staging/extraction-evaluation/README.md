# Isolated extraction evaluation

This is a one-shot staging job, not the production crawler or CRM service.
The standalone `staging/extraction-offline-20261111` GitHub branch contains an
allowlisted snapshot. **Do not merge that standalone tree into the application
branch.** Production systems, credentials, live captures, and outreach entrypoints
are excluded. Only synthetic fixtures and disposable databases are evaluated.

Run from the original repository:

```
python3 -B staging/extraction-evaluation/package.py /tmp/new-extraction-snapshot
python3 -B /tmp/new-extraction-snapshot/tests/extraction/run_offline.py --pr CORRECTIONS
```

The exporter refuses existing destinations and uses `source-paths.json`, collected
from successful guarded tests, plus explicit process/measurement dependencies.
Every exported file is SHA-256 checked before the staging test suites run.
A new code dependency requires updating the allowlist and rerunning snapshot tests.

Build the exported directory using its root Dockerfile. It installs the existing
lxml dependency (6.1.1) and uses libseccomp solely for the evaluation environment.
The unprivileged entrypoint installs irreversible inherited OS socket denial
before importing extractors. Linux process tests refuse to run without that
isolation. macOS process tests continue using sandbox-exec.

The job runs cumulative tests, actual process interruption/recovery tests,
backup/retention tests, and synthetic accuracy/release measurements. JSON results
are emitted with STAGING_SUITE_RESULT, STAGING_ARTIFACT, and STAGING_FINAL prefixes.
There is no HTTP endpoint, scheduler, data volume, or automatic restart.
Image builds require dependency downloads; application runtime networking is denied.
Passing staging tests does not override the real-corpus NO-GO release decision.

Rollback: remove/stop only the isolated staging deployment. No production database
migration or application rollback is required. The sole pre-existing test-file
change replaces the macOS-only process launcher with a platform-verifying helper.
The original macOS deny-network profile remains unchanged.
