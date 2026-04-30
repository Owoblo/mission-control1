export const BRAND = {
  name: 'Saturn Star Movers',
  phone: '226-724-1730',
  email: 'info@saturnstarmovers.ca',
}

export const REVIEW_LINKS = {
  google: process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL || '',
  yelp: process.env.NEXT_PUBLIC_YELP_REVIEW_URL || 'https://www.yelp.com/writeareview/biz/saturn-star-movers',
  facebook: process.env.NEXT_PUBLIC_FACEBOOK_REVIEW_URL || 'https://www.facebook.com/saturnstarmovers/reviews',
}

export const INCENTIVE_AMOUNT = 50

/**
 * Local caller ID mapping — city keywords → Twilio number to display as From.
 * All numbers forward to the main line; outbound calls use the matching local number
 * so the lead sees a familiar area code. Add/update as numbers are acquired.
 *
 * Env var NEXT_PUBLIC_TWILIO_NUMBERS_JSON overrides this at deploy time.
 * Format: JSON array of { keywords: string[], number: string }
 */
export const LOCAL_CALLER_IDS: Array<{ keywords: string[]; number: string; label: string }> = (() => {
  try {
    const env = process.env.NEXT_PUBLIC_TWILIO_NUMBERS_JSON
    if (env) return JSON.parse(env)
  } catch { /* fall through */ }
  return [
    { keywords: ['kitchener', 'waterloo', 'cambridge'], number: '+15199003456', label: 'Kitchener' },
    { keywords: ['windsor', 'lakeshore', 'tecumseh', 'lasalle', 'amherstburg'], number: '+12267732993', label: 'Windsor' },
    { keywords: ['ottawa', 'gatineau', 'kanata', 'nepean', 'gloucester'], number: '+16135550199', label: 'Ottawa' },
    { keywords: ['london', 'strathroy', 'st thomas', 'saint thomas'], number: '+15195550123', label: 'London' },
    { keywords: ['toronto', 'scarborough', 'north york', 'etobicoke', 'mississauga', 'brampton'], number: '+14165550100', label: 'Toronto' },
    { keywords: ['hamilton', 'burlington', 'oakville', 'stoney creek'], number: '+19055550111', label: 'Hamilton' },
  ]
})()

export function matchCallerIdForCity(city: string): { number: string; label: string } | null {
  if (!city) return null
  const normalized = city.toLowerCase()
  for (const entry of LOCAL_CALLER_IDS) {
    if (entry.keywords.some(kw => normalized.includes(kw))) {
      return { number: entry.number, label: entry.label }
    }
  }
  return null
}
