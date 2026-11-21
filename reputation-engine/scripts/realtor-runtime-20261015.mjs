import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs';import {parseEnv} from 'node:util';
process.env.TELNYX_API_KEY=parseEnv(fs.readFileSync('.env.local','utf8')).TELNYX_API_KEY;
