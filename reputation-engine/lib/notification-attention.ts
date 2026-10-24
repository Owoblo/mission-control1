/** Routine updates stay in the bell/queues. Only urgent work may interrupt. */
export function chooseInterruptingNotification<T extends { priority: string; time: string }>(items: T[]): T | undefined {
  return items.filter(item => item.priority === 'interrupt').sort((a,b) => b.time.localeCompare(a.time))[0]
}
