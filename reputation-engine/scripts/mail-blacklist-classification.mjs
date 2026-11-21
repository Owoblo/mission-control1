// SEM-FRESH lists describe domain age, not observed abuse.
// Source: https://spameatingmonkey.com/services
const AGE_LISTS = new Set(['sem_freshzero', 'sem_fresh', 'sem_fresh10', 'sem_fresh15', 'sem_fresh30']);
export function classifyBlacklistScan(scan, now = Date.now()) {
  if (!scan || !Array.isArray(scan.blacklists) || !Number.isFinite(Date.parse(scan.created_at)) ||
      now - Date.parse(scan.created_at) > 48 * 3600000 || Date.parse(scan.created_at) > now + 300000) {
    return { status: 'unknown', ageListings: [], otherListings: [] };
  }
  const detected = scan.blacklists.filter(row => row.detected === true);
  if (!Number.isInteger(scan.detections) || scan.detections !== detected.length ||
      scan.blacklists.some(row => typeof row.detected !== 'boolean' || typeof row.id !== 'string')) {
    return { status: 'unknown', ageListings: [], otherListings: [] };
  }
  const ageListings = detected.filter(row => AGE_LISTS.has(row.id)).map(row => row.name || row.id);
  const otherListings = detected.filter(row => !AGE_LISTS.has(row.id)).map(row => row.name || row.id);
  return { status: otherListings.length ? 'listed' : ageListings.length ? 'new_domain' : 'clear', ageListings, otherListings, checkedAt: scan.created_at };
}
