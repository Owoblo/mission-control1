#!/usr/bin/env bash
# Saturn design constitution — lint teeth.
# Fails if hardcoded hexes outside the canonical palette, arbitrary text
# sizes, or arbitrary radii appear in app/. Run in CI.
set -euo pipefail
cd "$(dirname "$0")/.."

ALLOW='071421|c99700|8a6800|f7f4ed|ffffff|667085|e5e7eb|f9fafb|0f6a53|ecfdf3|eff6ff|b42318|fef2f2|1d4ed8|fffaeb|92400e|1877f2|25d366|fdba74|93c5fd'
fail=0

echo "== hex palette =="
bad_hex=$(grep -rhoE --include='*.tsx' --include='*.ts' --include='*.css' \
  -i '#[0-9a-f]{3,8}\b' app/ | tr '[:upper:]' '[:lower:]' | sed 's/^#//' \
  | grep -vE "^(${ALLOW})$" | sort -u || true)
if [ -n "$bad_hex" ]; then
  echo "non-canonical hexes found:"; echo "$bad_hex"; fail=1
else echo "ok"; fi

echo "== text sizes =="
bad_text=$(grep -rhoE --include='*.tsx' 'text-\[[0-9]+px\]' app/ | sort -u | grep -v 'text-\[11px\]' || true)
if [ -n "$bad_text" ]; then
  echo "arbitrary text sizes found (only text-[11px] allowed):"; echo "$bad_text"; fail=1
else echo "ok"; fi

echo "== radii =="
bad_radius=$(grep -rhoE --include='*.tsx' 'rounded-\[[0-9]+px\]' app/ | sort -u || true)
if [ -n "$bad_radius" ]; then
  echo "arbitrary radii found:"; echo "$bad_radius"; fail=1
else echo "ok"; fi

if [ "$fail" -ne 0 ]; then
  echo "DESIGN CONSTITUTION VIOLATION — see Saturn design vision."
  exit 1
fi
echo "constitution holds."
