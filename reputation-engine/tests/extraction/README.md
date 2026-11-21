# Offline extraction checks (PR-00 through PR-02)

Run from the repository root with the existing Python environment and lxml installation. No dependency installation, credentials, network, production databases or saved real-business pages are needed.

```sh
python3 -B tests/extraction/run_offline.py --pr PR-00
python3 -B tests/extraction/run_offline.py --pr PR-01
python3 -B tests/extraction/run_offline.py --pr PR-02
python3 -B tests/extraction/run_offline.py --all
```

`--all` means the explicit implemented PR-00..02 allowlist, not every repository test. The runner guards imports as well as test execution, disables bytecode writes, and creates its own temporary write root. Expected guard self-test denials are scoped; unexpected denials make the runner fail even if application code catches their exceptions. Socket creation/DNS, subprocesses, writes outside that root, and SQLite connections outside that root are blocked. Fixture databases exist only under that temporary directory. Existing acquisition tests mock transport and inject their collector.

This is a Python audit boundary for trusted tests, not a security sandbox against malicious Python or native extensions. It does not intercept arbitrary C-library networking or descriptor writes. No OS network-denied integration job is claimed. Future multiprocess tests must propagate isolation or use a separate OS sandbox; they are not in this allowlist.

## Reproduce the comparison

```sh
EXTRACTION_REVIEW_DIR=$(mktemp -d "${TMPDIR:-/tmp}/extraction-review.XXXXXX")
python3 -B -m scripts.market_map.extraction_benchmark \
  --manifest tests/extraction/fixtures/manifest.json \
  --labels tests/extraction/fixtures/labels.jsonl \
  --baseline tests/extraction/results/pr01-run.json \
  --output "$EXTRACTION_REVIEW_DIR/replay" --offline
python3 -B tests/extraction/compare_normalization.py \
  --output "$EXTRACTION_REVIEW_DIR/normalization"
```

Outputs must use a **new** child of Python's system temporary directory. The benchmark cannot overwrite fixtures or stored baselines. `run.json` contains full outputs, hashes, runtime versions and scores; `changes.json` records complete before/after records including metadata, removed values, raw observations and evidence. Compare predictions/scores rather than historical source hashes when the harness itself has changed.

## Corpus contract and limitations

Seventeen self-authored synthetic HTML pages use reserved `.test` domains and fictional identities. The implementation request authorizes these regression fixtures; no real captures or personal data were imported. `manifest.json` freezes body SHA-256 hashes, source URLs, explicit synthetic approval and retention labels. `labels.jsonl` separately labels emails, phones (base + extension + kind), and person-card edges. `phone_candidates.json` adds 37 raw normalization examples; its hash is recorded in the comparison output. No fixture was downloaded.

Extraction scoring is **page-unique channel** scoring: duplicate extraction methods on one page count once. It is not occurrence-level recall, business-level yield or population accuracy. Phone-kind scoring is separate from phone-value scoring. A shared Phone/Fax field is labeled `fax` here as the conservative legacy exclusion bucket, not as proof it is exclusively a fax line. Null denominators remain null. Unknown company ownership is not manufactured from hosts or names; the two positive attribution labels measure person-card association only. Company/site ownership accuracy cannot be established from this corpus.

Known email misses/false positives remain measured rather than xfailed. Phone safety tests require zero false positives/misses on this development corpus. Passing that gate does not imply 100% real-world accuracy. No fetch failures were sampled, and no throughput, cost, representative confidence interval or holdout result is claimed.

Real captures are deliberately rejected by the current importer: importing them needs a reviewed approval/retention/receipt contract, labeling and adjudication. Future fixture additions should create a new versioned corpus and paired baselines, not silently edit these frozen bodies or labels.

## Artifact inventory

`results/` includes the original phone source (hash-checked by the normalization comparison), sequential runtime-only patches, three replay snapshots, two full change ledgers, the raw normalization comparison and the final test log. Runtime patches modify only the existing extractor; new modules/tests are listed in the root implementation report. They are review artifacts, not commits or deployments.
