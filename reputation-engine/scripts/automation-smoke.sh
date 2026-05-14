#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

set -a
source "${ENV_PATH:-.env.local}"
set +a

BASE_URL="${BASE_URL:-http://127.0.0.1:3005}"
COOKIE_JAR="${COOKIE_JAR:-/tmp/automation-smoke-$$.cookies.txt}"
VERCEL_DEPLOYMENT="${VERCEL_DEPLOYMENT:-}"
VERCEL_CLI_TOKEN="${VERCEL_CLI_TOKEN:-}"
LOGIN_EMAIL="${LOGIN_EMAIL:-}"
LOGIN_PASSWORD="${LOGIN_PASSWORD:-${AUTH_PASSWORD:-}}"

SUPPRESSION_LEAD_ID=""
QUOTE_LEAD_ID=""
QUOTE_ID=""

log() {
  printf '[%s] %s\n' "$1" "$2"
}

cleanup_artifacts() {
  local lead_id="$1"
  local quote_hint="${2:-}"

  [[ -n "$lead_id" ]] || return 0

  api_json DELETE "/api/sales/leads/$lead_id" '' >/dev/null 2>&1 || true

  local quotes_file
  quotes_file="$(mktemp)"
  curl -sS \
    "$SUPABASE_URL/rest/v1/crm_quotes?select=id,data&deleted=eq.false&data->>leadId=eq.${lead_id}" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    > "$quotes_file" || true

  while IFS='|' read -r quote_id client_id; do
    [[ -n "$quote_id" ]] || continue
    curl -sS -o /dev/null -w '' \
      -X PATCH \
      "$SUPABASE_URL/rest/v1/crm_quotes?id=eq.${quote_id}" \
      -H "apikey: $SUPABASE_KEY" \
      -H "Authorization: Bearer $SUPABASE_KEY" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=minimal" \
      --data "{\"deleted\":true,\"updated_at\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"}" || true

    if [[ -n "$client_id" ]]; then
      curl -sS -o /dev/null -w '' \
        -X PATCH \
        "$SUPABASE_URL/rest/v1/crm_clients?id=eq.${client_id}" \
        -H "apikey: $SUPABASE_KEY" \
        -H "Authorization: Bearer $SUPABASE_KEY" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=minimal" \
        --data "{\"deleted\":true,\"updated_at\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"}" || true
    fi
  done < <(
    python3 - "$quotes_file" "$quote_hint" <<'PY'
import json, sys
rows = json.load(open(sys.argv[1]))
hint = sys.argv[2]
seen = set()
if hint:
    seen.add(hint)
for row in rows:
    qid = row.get("id", "")
    if qid and qid not in seen:
        seen.add(qid)
    data = row.get("data", {}) or {}
    cid = data.get("clientId", "") or ""
    if qid:
        print(f"{qid}|{cid}")
PY
  )

  rm -f "$quotes_file"

  for table in crm_followup_logs crm_emails; do
    curl -sS -o /dev/null -w '' \
      -X PATCH \
      "$SUPABASE_URL/rest/v1/${table}?data->>leadId=eq.${lead_id}" \
      -H "apikey: $SUPABASE_KEY" \
      -H "Authorization: Bearer $SUPABASE_KEY" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=minimal" \
      --data "{\"deleted\":true,\"updated_at\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"}" || true
  done

  curl -sS -o /dev/null -w '' \
    -X DELETE \
    "$SUPABASE_URL/rest/v1/crm_conversation_threads?lead_id=eq.${lead_id}" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Prefer: return=minimal" || true

  curl -sS -o /dev/null -w '' \
    -X DELETE \
    "$SUPABASE_URL/rest/v1/crm_automation_jobs?lead_id=eq.${lead_id}" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Prefer: return=minimal" || true
}

finish() {
  cleanup_artifacts "$SUPPRESSION_LEAD_ID"
  [[ -n "$SUPPRESSION_LEAD_ID" ]] && log cleanup "Cleaned suppression lead $SUPPRESSION_LEAD_ID"
  cleanup_artifacts "$QUOTE_LEAD_ID" "$QUOTE_ID"
  [[ -n "$QUOTE_LEAD_ID" ]] && log cleanup "Cleaned quote lead $QUOTE_LEAD_ID"
  rm -f "$COOKIE_JAR"
}

trap finish EXIT

api_json() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local internal="${4:-0}"
  local outfile
  outfile="$(mktemp)"

  local -a args

  if [[ -n "$VERCEL_DEPLOYMENT" ]]; then
    args=(
      npx vercel curl "$path"
      --deployment "$VERCEL_DEPLOYMENT"
      --token "$VERCEL_CLI_TOKEN"
      --
      -sS
      -o "$outfile"
      -w '%{http_code}'
      -b "$COOKIE_JAR"
      -c "$COOKIE_JAR"
      -X "$method"
    )
  else
    args=(
      curl
      -sS
      -o "$outfile"
      -w '%{http_code}'
      -b "$COOKIE_JAR"
      -c "$COOKIE_JAR"
      -X "$method"
      "$BASE_URL$path"
    )
  fi

  if [[ -n "$data" ]]; then
    args+=(-H 'Content-Type: application/json' --data "$data")
  fi

  if [[ "$internal" == "1" ]]; then
    args+=(-H "x-internal-secret: $WORKER_SHARED_SECRET")
  fi

  local status
  if [[ -n "$VERCEL_DEPLOYMENT" ]]; then
    status="$("${args[@]}")"
  else
    status="$("${args[@]}")"
  fi
  if (( status < 200 || status >= 300 )); then
    printf 'HTTP %s for %s %s\n' "$status" "$method" "$path" >&2
    cat "$outfile" >&2
    rm -f "$outfile"
    return 1
  fi

  cat "$outfile"
  rm -f "$outfile"
}

supabase_json() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local outfile
  outfile="$(mktemp)"

  local -a args=(
    -sS
    -o "$outfile"
    -w '%{http_code}'
    -X "$method"
    "$SUPABASE_URL/rest/v1/$path"
    -H "apikey: $SUPABASE_KEY"
    -H "Authorization: Bearer $SUPABASE_KEY"
  )

  if [[ -n "$data" ]]; then
    args+=(-H 'Content-Type: application/json' -H 'Prefer: return=minimal' --data "$data")
  fi

  local status
  status="$(curl "${args[@]}")"
  if (( status < 200 || status >= 300 )); then
    printf 'Supabase HTTP %s for %s %s\n' "$status" "$method" "$path" >&2
    cat "$outfile" >&2
    rm -f "$outfile"
    return 1
  fi

  cat "$outfile"
  rm -f "$outfile"
}

assert_json() {
  local file="$1"
  shift
  python3 - "$file" "$@" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
namespace = {"data": data}
for expr in sys.argv[2:]:
    if not eval(expr, {}, namespace):
        raise AssertionError(expr)
PY
}

json_value() {
  local file="$1"
  local expr="$2"
  python3 - "$file" "$expr" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
print(eval(sys.argv[2], {}, {"data": data}))
PY
}

log auth "Logging in as owner"
login_file="$(mktemp)"
if [[ -n "$LOGIN_EMAIL" ]]; then
  api_json POST /api/auth/login '{"email":"'"$LOGIN_EMAIL"'","password":"'"$LOGIN_PASSWORD"'"}' > "$login_file"
  assert_json "$login_file" "data.get('ok') is True and data.get('role') in ('owner', 'sales_rep', 'crew')"
else
  api_json POST /api/auth/login '{"password":"'"$LOGIN_PASSWORD"'"}' > "$login_file"
  assert_json "$login_file" "data.get('ok') is True and data.get('role') == 'owner'"
fi
rm -f "$login_file"

SCAN_ADDRESS='1040 Kennedy Dr W, Windsor, ON N9G 1T1'
DESTINATION_ADDRESS='2163 Victoria Ave, Windsor, ON'
RUN_SUFFIX="$(date +%s)"

log enrich "Checking listing-backed address enrichment"
enrich_file="$(mktemp)"
api_json POST /api/sales/enrich/address '{"address":"'"$SCAN_ADDRESS"'"}' > "$enrich_file"
assert_json "$enrich_file" \
  "data['listing']['zpid'] == 456977589" \
  "data['analysisAvailable'] is True" \
  "data['scan']['totalItems'] > 0" \
  "data['scan']['totalCubicFeet'] > 0"
rm -f "$enrich_file"

log route "Checking route-estimate helper path"
route_file="$(mktemp)"
api_json POST /api/sales/route-estimate '{"origin":"'"$SCAN_ADDRESS"'","destination":"'"$DESTINATION_ADDRESS"'","branch":"windsor"}' > "$route_file"
assert_json "$route_file" \
  "data['pricingStatus'] == 'ready'" \
  "data['billableDriveHours'] > 0"
rm -f "$route_file"

SUPPRESSION_EMAIL="automation-suppress-${RUN_SUFFIX}@example.com"
QUOTE_EMAIL="automation-quote-${RUN_SUFFIX}@example.com"
HAS_RESEND=0

if [[ -n "${RESEND_API_KEY:-}" ]]; then
  HAS_RESEND=1
fi

log handoff "Creating synthetic rep-owned lead"
suppression_create="$(mktemp)"
api_json POST /api/sales/leads '{"forceNew":true,"name":"Automation Suppression '"$RUN_SUFFIX"'","email":"'"$SUPPRESSION_EMAIL"'","source":"automation_smoke","moveType":"residential"}' > "$suppression_create"
SUPPRESSION_LEAD_ID="$(json_value "$suppression_create" "data['id']")"
rm -f "$suppression_create"

manual_handoff="$(mktemp)"
api_json PATCH "/api/sales/leads/${SUPPRESSION_LEAD_ID}/automation" '{"automationStatus":"handoff","pauseHours":24,"handoffReason":"Smoke test rep handoff"}' > "$manual_handoff"
assert_json "$manual_handoff" \
  "data['automationStatus'] == 'handoff'" \
  "bool(data.get('automationPausedUntil'))"
rm -f "$manual_handoff"

manual_clear="$(mktemp)"
api_json PATCH "/api/sales/leads/${SUPPRESSION_LEAD_ID}/automation" '{"automationStatus":"active","clearPause":true}' > "$manual_clear"
assert_json "$manual_clear" \
  "data['automationStatus'] == 'active'" \
  "data.get('automationPausedUntil') in (None, '')"
rm -f "$manual_clear"

rep_owned="$(mktemp)"
api_json PATCH "/api/sales/leads/${SUPPRESSION_LEAD_ID}" '{"stage":"estimate_scheduled","assignedRep":"Smoke Rep","estimateDate":"'"$(date -u -v+1d +%Y-%m-%d 2>/dev/null || python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat())
PY
)"'"}' > "$rep_owned"
assert_json "$rep_owned" \
  "data['automationStatus'] == 'handoff'" \
  "data['automationPauseReason'] == 'estimate_or_rep_workflow'"
rm -f "$rep_owned"

suppression_ingest="$(mktemp)"
api_json POST /api/sales/automation/ingest '{"source":"automation_smoke","channel":"email","email":"'"$SUPPRESSION_EMAIL"'","name":"Automation Suppression '"$RUN_SUFFIX"'","subject":"Need an update","message":"Checking whether we are still on for the estimate.","receivedAt":"'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"}' 1 > "$suppression_ingest"
assert_json "$suppression_ingest" \
  "data['thread']['status'] == 'human_handoff'" \
  "data['job']['status'] == 'cancelled'"
rm -f "$suppression_ingest"

suppression_emails="$(mktemp)"
supabase_json GET "crm_emails?select=id,data&deleted=eq.false&data->>leadId=eq.${SUPPRESSION_LEAD_ID}" > "$suppression_emails"
assert_json "$suppression_emails" "len(data) == 0"
rm -f "$suppression_emails"

log quote "Creating synthetic qualified lead for automated quote generation"
quote_create="$(mktemp)"
future_move_date="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat())
PY
)"
api_json POST /api/sales/leads '{"forceNew":true,"name":"Automation Quote '"$RUN_SUFFIX"'","email":"'"$QUOTE_EMAIL"'","source":"automation_smoke","moveType":"residential","moveDate":"'"$future_move_date"'","branch":"windsor","originAddress":"'"$SCAN_ADDRESS"'","originCity":"Windsor","destAddress":"'"$DESTINATION_ADDRESS"'","destCity":"Windsor"}' > "$quote_create"
QUOTE_LEAD_ID="$(json_value "$quote_create" "data['id']")"
rm -f "$quote_create"

quote_ingest="$(mktemp)"
api_json POST /api/sales/automation/ingest '{"source":"automation_smoke","channel":"email","email":"'"$QUOTE_EMAIL"'","name":"Automation Quote '"$RUN_SUFFIX"'","subject":"Please send estimate","message":"Please send the estimate over. We are ready to review pricing.","receivedAt":"'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"}' 1 > "$quote_ingest"
if (( HAS_RESEND == 1 )); then
  assert_json "$quote_ingest" \
    "data['job']['status'] == 'completed'" \
    "data['thread']['status'] == 'open'"
else
  assert_json "$quote_ingest" \
    "data['job']['status'] == 'cancelled'" \
    "'email delivery is not configured' in (data['job'].get('result', {}).get('reason', '')).lower()"
fi
rm -f "$quote_ingest"

quote_lead_file="$(mktemp)"
api_json GET "/api/sales/leads/${QUOTE_LEAD_ID}" > "$quote_lead_file"
if (( HAS_RESEND == 1 )); then
  assert_json "$quote_lead_file" \
    "bool(data.get('automatedQuoteId') or data.get('quoteId'))" \
    "bool(data.get('automatedQuoteSentAt'))" \
    "data['totalCubicFeet'] > 0" \
    "len(data.get('inventory') or []) > 0"
  QUOTE_ID="$(json_value "$quote_lead_file" "data.get('automatedQuoteId') or data.get('quoteId')")"
else
  assert_json "$quote_lead_file" \
    "data['automationStatus'] == 'handoff'" \
    "not bool(data.get('automatedQuoteSentAt'))" \
    "not bool(data.get('automatedQuoteId') or data.get('quoteId'))" \
    "data['totalCubicFeet'] > 0" \
    "len(data.get('inventory') or []) > 0"
fi
rm -f "$quote_lead_file"

quote_threads="$(mktemp)"
supabase_json GET "crm_conversation_threads?select=id,status,automation_status,automation_owner&lead_id=eq.${QUOTE_LEAD_ID}" > "$quote_threads"
if (( HAS_RESEND == 1 )); then
  assert_json "$quote_threads" \
    "len(data) >= 1" \
    "all(row['status'] == 'open' for row in data)"
else
  assert_json "$quote_threads" \
    "len(data) >= 1" \
    "all(row['status'] == 'human_handoff' for row in data)" \
    "all(row['automation_status'] == 'handoff' for row in data)"
fi
rm -f "$quote_threads"

if (( HAS_RESEND == 1 )); then
  quote_detail_file="$(mktemp)"
  api_json GET "/api/sales/quotes/${QUOTE_ID}" > "$quote_detail_file"
  assert_json "$quote_detail_file" \
    "data['quote']['status'] == 'sent'" \
    "data['quote']['leadId'] == '$QUOTE_LEAD_ID'" \
    "data['quote']['total'] > 0"
  rm -f "$quote_detail_file"

  quote_emails="$(mktemp)"
  supabase_json GET "crm_emails?select=id,data&deleted=eq.false&data->>leadId=eq.${QUOTE_LEAD_ID}" > "$quote_emails"
  assert_json "$quote_emails" \
    "len(data) == 1" \
    "'estimate is ready' in data[0]['data']['subject'].lower()"
  rm -f "$quote_emails"
else
  quote_emails="$(mktemp)"
  supabase_json GET "crm_emails?select=id,data&deleted=eq.false&data->>leadId=eq.${QUOTE_LEAD_ID}" > "$quote_emails"
  assert_json "$quote_emails" "len(data) == 0"
  rm -f "$quote_emails"

  quote_rows="$(mktemp)"
  supabase_json GET "crm_quotes?select=id,data&deleted=eq.false&data->>leadId=eq.${QUOTE_LEAD_ID}" > "$quote_rows"
  assert_json "$quote_rows" "len(data) == 0"
  rm -f "$quote_rows"
fi

quote_jobs="$(mktemp)"
supabase_json GET "crm_automation_jobs?select=id,kind,status,result&lead_id=eq.${QUOTE_LEAD_ID}&order=created_at.desc" > "$quote_jobs"
if (( HAS_RESEND == 1 )); then
  assert_json "$quote_jobs" \
    "any(job['kind'] == 'lead_response' and job['status'] == 'completed' for job in data)"
else
  assert_json "$quote_jobs" \
    "any(job['kind'] == 'lead_response' and job['status'] == 'cancelled' for job in data)"
fi
rm -f "$quote_jobs"

log pass "Automation smoke checks passed"
log pass "Suppression lead: $SUPPRESSION_LEAD_ID"
log pass "Quote lead: $QUOTE_LEAD_ID"
log pass "Quote id: $QUOTE_ID"
