import fs from 'node:fs';
import { summarizeWarmupEvents } from '../lib/partnership-core/warmup-metrics.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/report-partnership-warmup-metrics.mjs path/to/events.jsonl [days]');
const days = process.argv[3] ? Number(process.argv[3]) : 7;
const events = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
  try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on line ${index + 1}`); }
});
console.log(JSON.stringify(summarizeWarmupEvents(events, { days }), null, 2));
