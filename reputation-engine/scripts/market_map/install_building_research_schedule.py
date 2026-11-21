"""Install the reviewed local hourly research job after a successful live pilot.

This writes ~/Library/LaunchAgents and must be run with the required OS permission.
It never changes Codex authentication, permissions or model configuration.
"""
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / 'artifacts/windsor-building-ledger-20261029'
LABEL = 'ca.saturnstarmovers.windsor-research'


def main():
    if '--disable' in sys.argv[1:]:
        service = 'gui/' + str(os.getuid()) + '/' + LABEL
        subprocess.run(['/bin/launchctl', 'disable', service], check=True)
        subprocess.run(['/bin/launchctl', 'bootout', service], capture_output=True)
        path = STATE / 'scheduler/installation.json'
        receipt = json.loads(path.read_text()) if path.exists() else {'label': LABEL}
        receipt.update({'enabled': False, 'disabled_reason': 'macOS denies background access to project in Downloads; cloud execution preferred'})
        path.write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt, indent=2))
        return
    status = json.loads((STATE / 'supervisor-status.json').read_text())
    if (STATE / 'PAUSED').exists() or status['state'] != 'finished':
        raise RuntimeError('Resolve pilot or pause before enabling a recurring job')
    if len(status['results']) != 3 or any(r['state'] != 'submitted' for r in status['results']):
        raise RuntimeError('Three accepted live worker results are required before scheduling')
    source = STATE / 'scheduler' / (LABEL + '.plist')
    body = source.read_bytes()
    config = plistlib.loads(body)
    expected = [str(ROOT / '.runtime/market-map-python/bin/python'), '-B', '-m',
                'scripts.market_map.building_research_supervisor', '--workers', '3',
                '--daily-limit', '72', '--timeout', '720']
    if (config['ProgramArguments'] != expected or config['Label'] != LABEL
            or config['StartInterval'] != 3600 or config['RunAtLoad']):
        raise RuntimeError('Schedule differs from tested bounded rollout')
    target = Path.home() / 'Library/LaunchAgents' / source.name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.read_bytes() != body:
        raise RuntimeError('A different schedule already exists; inspect before replacing')
    target.write_bytes(body)
    target.chmod(0o600)
    domain = 'gui/' + str(os.getuid())
    service = domain + '/' + LABEL
    current = subprocess.run(['/bin/launchctl', 'print', service], capture_output=True)
    if current.returncode:
        subprocess.run(['/bin/launchctl', 'bootstrap', domain, str(target)], check=True)
    check = subprocess.run(['/bin/launchctl', 'print', service], capture_output=True, text=True)
    if check.returncode:
        raise RuntimeError('launchctl did not confirm registration: ' + check.stderr)
    receipt = {'installed': True, 'label': LABEL, 'plist': str(target),
               'interval_seconds': 3600, 'workers': 3, 'max_daily_starts': 72,
               'pilot_run': status['run_id'], 'requires_awake_logged_in_mac': True,
               'stop_command': 'launchctl bootout ' + service}
    (STATE / 'scheduler/installation.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
