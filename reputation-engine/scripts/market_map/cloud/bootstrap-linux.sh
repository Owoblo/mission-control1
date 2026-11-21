#!/usr/bin/env bash
# Run on the selected Ubuntu 24.04 VM after code/data transfer. Does not start work.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root on the target Linux host.' >&2; exit 1; }
app=/opt/saturn-research
account=saturnresearch
[[ -f "$app/scripts/market_map/building_research_supervisor.py" ]] || { echo 'Transfer reviewed application first.' >&2; exit 1; }
apt-get update
apt-get install -y python3 python3-venv nodejs npm ca-certificates
id "$account" >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/saturnresearch --shell /usr/sbin/nologin "$account"
python3 -m venv "$app/.runtime/market-map-python"
"$app/.runtime/market-map-python/bin/pip" install -r "$app/scripts/market_map/requirements.txt" -r "$app/scripts/market_map/requirements-spatial.txt"
npm install --prefix /opt/saturn-codex @openai/codex@0.164.0
install -d -m 700 -o "$account" -g "$account" /var/lib/saturnresearch/.local/bin "$app/.runtime/openai-api-codex"
ln -sfn /opt/saturn-codex/node_modules/.bin/codex /var/lib/saturnresearch/.local/bin/codex
install -d -o "$account" -g "$account" "$app/artifacts/windsor-building-ledger-20261029" /var/backups/saturn-research
# Existing portable queue state, lease state, receipts and full playbook must be copied before enabling.
printf '%s\n' '{"reason":"Cloud deployment and model-quality benchmark pending; no automatic promotion."}' > "$app/artifacts/windsor-building-ledger-20261029/PAUSED"
cat > "$app/.runtime/openai-api-codex/config.toml" <<'CONFIG'
# Explicit existing baseline; benchmark must pass before any model promotion.
model = "gpt-5.4"
model_reasoning_effort = "low"
forced_login_method = "api"
CONFIG
chmod 600 "$app/.runtime/openai-api-codex/config.toml"
chmod 755 "$app/scripts/market_map/codex_api_worker.py"
chown -R "$account:$account" "$app"
install -m 644 "$app/scripts/market_map/cloud/systemd/"* /etc/systemd/system/
systemctl daemon-reload
printf '%s\n' 'Installed but PAUSED. Install API credential separately, run preflight/tests, then perform single-owner cutover before enabling timer.'
