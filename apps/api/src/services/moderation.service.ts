const BLOCKLIST = [
  'kill', 'murder', 'suicide', 'bomb', 'terror',
  'child', 'minor', 'underage',
  'doxx', 'swat',
  'nude', 'naked', 'sex',
  'racist', 'slur',
]

export function checkBlocklist(text: string): string[] {
  const lower = text.toLowerCase()
  return BLOCKLIST.filter((word) => lower.includes(word))
}

export function isDescriptionAllowed(description: string): { allowed: boolean; reason?: string } {
  if (description.length < 1 || description.length > 280) {
    return { allowed: false, reason: 'Description must be 1-280 characters' }
  }

  const flagged = checkBlocklist(description)
  if (flagged.length > 0) {
    return { allowed: false, reason: `Contains prohibited content: ${flagged.join(', ')}` }
  }

  return { allowed: true }
}
