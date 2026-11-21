// Compatibility entry point: GTA cards must use the established Sold2Move builder.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./render-gta-sold2move-cards.cjs', import.meta.url))], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
