#!/usr/bin/env python3
"""Run the existing research harness with isolated, API-only authentication."""
import json
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
state = root / '.runtime/openai-api-codex'
auth = state / 'auth.json'
if not auth.is_file() or not json.loads(auth.read_text()).get('OPENAI_API_KEY'):
    raise SystemExit('Isolated API credential is missing; subscription fallback is disabled.')
env = dict(os.environ, CODEX_HOME=str(state))
binary = str(Path.home() / '.local/bin/codex')
os.execve(binary, [binary, '-c', 'forced_login_method="api"', *sys.argv[1:]], env)
