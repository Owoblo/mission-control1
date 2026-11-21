#!/usr/bin/env python3
"""Read an API key from stdin into the existing isolated harness, without echo."""
import json,os,sys
from pathlib import Path
root=Path(__file__).resolve().parents[3]
key=sys.stdin.read().strip()
if not key or '\n' in key or '\r' in key:raise SystemExit('Expected one nonempty API key on stdin')
path=root/'.runtime/openai-api-codex/auth.json'
path.parent.mkdir(parents=True,exist_ok=True);path.parent.chmod(0o700)
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as stream:
 json.dump({'OPENAI_API_KEY':key},stream);stream.flush();os.fsync(stream.fileno())
path.chmod(0o600)
print('API credential installed; key not displayed.')
