"""Volume-resident startup wrapper: original service plus preparation scheduler."""
import os,signal,subprocess,sys,time
from pathlib import Path
OUT=Path('/data/research/artifacts/daily-preparation-20261118')
stopped=False
def stop(*_):
 global stopped
 stopped=True
def main():
 for sig in [signal.SIGTERM,signal.SIGINT]:signal.signal(sig,stop)
 app=subprocess.Popen([sys.executable,'-u','-m','scripts.market_map.cloud.railway_entry'],cwd='/app')
 # Wait for the original service to synchronize its modules from the image.
 time.sleep(8)
 scaled=OUT/'scaled-geography'
 active=(scaled/'activation.json').exists()
 worker_script=scaled/'worker.py' if active else OUT/'worker.py'
 worker=subprocess.Popen([sys.executable,'-u',str(worker_script)],cwd='/data/research')
 buffer=subprocess.Popen([sys.executable,'-u',str(OUT/'prepared_buffer_worker.py')],cwd='/data/research')
 try:
  while not stopped and app.poll()is None:
   # A failed scheduler leaves a visible hold; never silently relaunch paid work.
   hold=(scaled if active else OUT)/'HOLD'
   if worker.poll()is not None and not hold.exists():hold.write_text('Preparation scheduler stopped; inspect worker logs before resuming.')
   if buffer.poll()is not None and not(OUT/'prepared-buffer/WORKER_STOPPED').exists():(OUT/'prepared-buffer/WORKER_STOPPED').write_text('Preparation projection stopped; last saved queue remains held.')
   time.sleep(1)
 finally:
  for p in [buffer,worker,app]:
   if p.poll()is None:p.terminate()
  for p in [buffer,worker,app]:
   try:p.wait(timeout=25)
   except subprocess.TimeoutExpired:p.kill()
 return app.returncode or 0
if __name__=='__main__':sys.exit(main())
