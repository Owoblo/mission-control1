"""Local Railway CLI wrapper; credentials stay out of command arguments/output."""
import json
import os
from pathlib import Path
import subprocess
import sys
import secrets
import base64
import urllib.request

ROOT=Path(__file__).resolve().parents[3]
CLI=Path('/Users/owoblo/.npm/_npx/79fa66f96c8fdacf/node_modules/@railway/cli/bin/railway')


if __name__=='__main__':
    auth=json.loads((ROOT/'.runtime/railway-research/auth.json').read_text())
    env=dict(os.environ,RAILWAY_API_TOKEN=auth['RAILWAY_API_TOKEN'],CI='true')
    env.pop('RAILWAY_TOKEN',None)
    args=sys.argv[1:];cwd=None
    if args[:1]==['--cwd']:
        cwd=Path(args[1]).resolve();args=args[2:]
        if ROOT not in cwd.parents:raise ValueError('Deployment directory must be inside project')
    if args in (['dashboard-status'],['dashboard-summary']):
        password=(ROOT/'.runtime/railway-research/dashboard-password').read_text()
        header='Basic '+base64.b64encode(('john:'+password).encode()).decode()
        request=urllib.request.Request('https://windsor-research-production.up.railway.app/status',
            headers={'Authorization':header})
        with urllib.request.urlopen(request,timeout=30) as response:
            result=json.load(response)
            if args==['dashboard-summary']:
                campaign=result.get('campaign',{})
                result={k:v for k,v in result.items() if k not in ('campaign','city_progress')}
                result['campaign_status']=campaign.get('status')
                result['latest_batch']=campaign.get('batches',[{}])[-1]
            print(json.dumps(result,indent=2))
        raise SystemExit(0)
    if args==['install-worker-secrets']:
        if cwd is None:raise ValueError('Explicit isolated deployment directory required')
        password_file=ROOT/'.runtime/railway-research/dashboard-password'
        if not password_file.exists():
            password_file.write_text(secrets.token_urlsafe(32));password_file.chmod(0o600)
        current_key=ROOT/'.runtime/railway-research/openai-current.json'
        if not current_key.exists():current_key=ROOT/'.runtime/openai-api-codex/auth.json'
        values={'OPENAI_API_KEY':json.loads(current_key.read_text())['OPENAI_API_KEY'],
            'DASHBOARD_PASSWORD':password_file.read_text()}
        for name,value in values.items():
            result=subprocess.run([str(CLI),'variable','set',name,'--stdin','--skip-deploys'],
                input=value,text=True,env=env,cwd=cwd,capture_output=True)
            if result.returncode:raise RuntimeError('Private variable installation failed for '+name)
            print('Installed private variable '+name)
        raise SystemExit(0)
    raise SystemExit(subprocess.call([str(CLI),*args],env=env,cwd=cwd))
