"""Guarded maintenance measurements using the same disposable regression fixtures."""
import argparse,importlib.util,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT));sys.dont_write_bytecode=True

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args();out=Path(a.output).resolve()
 if out.exists() or not out.is_relative_to(Path(tempfile.gettempdir()).resolve()):p.error('new temporary directory required')
 out.mkdir();tempfile.tempdir=str(out)
 from scripts.market_map.offline_guard import OfflineGuard
 guard=OfflineGuard(out);guard.install()
 from scripts.market_map import evidence_maintenance as maintenance
 spec=importlib.util.spec_from_file_location('measured_tests',ROOT/'tests/extraction/test_readiness_corrections.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 records=[];backup=maintenance.backup_bundle;restore=maintenance.restore_bundle;cleanup=maintenance.cleanup_capture_cache
 def measured_backup(root,dest,**kwargs):
  result=backup(root,dest,**kwargs);records.append({'stage':'backup','files':len(result['files']),'databases':len(result['database_logical_sha256']),'bytes':sum(p.stat().st_size for p in Path(dest).rglob('*') if p.is_file()),'body_files':sum(p.endswith('.body') for p in result['files'])});return result
 def measured_restore(*args,**kw):
  result=restore(*args,**kw);records.append({'stage':'restore',**result});return result
 def measured_cleanup(*args,**kw):
  result=cleanup(*args,**kw);records.append({'stage':'cleanup','status':result['status'],'applied':result['applied'],'receipt_actions':len(result['files']),'body_actions':sum(bool(r['body']) for r in result['files'])});return result
 suite=unittest.TestSuite([module.MaintenanceTests('test_bundle_three_queues_captures_history_holds_and_corruption'),module.MaintenanceTests('test_expiry_dry_run_protected_unknown_and_quota'),module.AdditionalSafetyTests('test_active_reference_and_maintenance_lock_protect_shared_body')])
 with patch.object(maintenance,'backup_bundle',side_effect=measured_backup),patch.object(maintenance,'restore_bundle',side_effect=measured_restore),patch.object(maintenance,'cleanup_capture_cache',side_effect=measured_cleanup):result=unittest.TextTestRunner(verbosity=2).run(suite)
 report={'tests_run':result.testsRun,'success':result.wasSuccessful(),'measurements':records,'guard_violations':guard.violations}
 (out/'maintenance-measurements.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));return 0 if result.wasSuccessful() and not guard.violations else 1
if __name__=='__main__':sys.exit(main())
