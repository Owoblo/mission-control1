export const MAX_AUTOMATION_JOB_ATTEMPTS = 3
export const AUTOMATION_JOB_LOCK_TIMEOUT_MS = 10 * 60_000

export function getAutomationJobRetryDelayMs(attempts: number) {
  const safeAttempts = Math.max(1, Math.floor(attempts || 1))
  return Math.min(5 * 60_000, 30_000 * (2 ** (safeAttempts - 1)))
}

export function shouldRetryAutomationJob(attempts: number) {
  return Math.max(0, Math.floor(attempts || 0)) < MAX_AUTOMATION_JOB_ATTEMPTS
}
