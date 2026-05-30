export interface ReadFirstSection {
  title: string
  items: string[]
}

export interface ReadFirstCard {
  title: string
  body: string
}

export const SALES_READ_FIRST_HIGHLIGHTS: ReadFirstCard[] = [
  {
    title: 'We over-serve',
    body: 'Customers should feel more guided, more informed, and more cared for after every interaction. The goal is not to sound clever. The goal is to make the move feel handled.',
  },
  {
    title: 'We sell with calm authority',
    body: 'Saturn Star reps do not mumble, chase, or argue. We lead the conversation, listen properly, explain clearly, and make the next step feel natural.',
  },
  {
    title: 'We protect operations',
    body: 'Nothing should be promised on the phone that ops cannot deliver in real life. Good sales protects trust, truck planning, crew readiness, and customer confidence at the same time.',
  },
]

export const SALES_READ_FIRST_IDENTITY: ReadFirstSection[] = [
  {
    title: 'What Saturn Star is',
    items: [
      'A residential moving company built around clear process, strong communication, and smooth execution.',
      'A service brand that uses technology to quote faster, confirm details better, and reduce customer stress.',
      'A team that aims to make customers feel taken care of, not rushed through a transaction.',
    ],
  },
  {
    title: 'What Saturn Star is not',
    items: [
      'We are not a pressure-heavy call center that talks over people.',
      'We are not a company that guesses on scope, hides policies, or sells jobs ops cannot support.',
      'We are not a commercial catch-all. We stay disciplined about what fits the residential lane and what needs review.',
    ],
  },
]

export const SALES_READ_FIRST_BRANCHES: ReadFirstCard[] = [
  {
    title: 'Windsor',
    body: 'Core branch for Windsor and the surrounding lane. Reps should sound fully comfortable serving local moves from this branch.',
  },
  {
    title: 'Kitchener-Waterloo',
    body: 'Active service area. If a customer asks whether we are based there, the answer is yes: we actively service Kitchener-Waterloo and quote moves there confidently.',
  },
  {
    title: 'Ottawa',
    body: 'Active service area. Reps should speak about Ottawa as a live operating lane, not as a vague future market.',
  },
]

export const SALES_READ_FIRST_NON_NEGOTIABLES: ReadFirstSection = {
  title: 'Rep Non-Negotiables',
  items: [
    'Capture name, phone, and email before you let the conversation drift too far.',
    'Lead the structure, but never confuse control with interrupting the customer.',
    'Confirm inventory, access, specialty items, and route before giving numbers.',
    'Explain minimums, deposits, and truck logic clearly so the customer never feels surprised later.',
    'Use empathy when life context comes up: grief, family change, new job, downsizing, or stress.',
    'End every meaningful conversation with a real next step: survey, quote, tentative reservation, follow-up time, or booking path.',
  ],
}

export const SALES_READ_FIRST_SERVICE_STANDARD: ReadFirstSection = {
  title: 'What Great Looks Like',
  items: [
    'The customer feels heard within the first minute.',
    'The rep sounds confident without sounding rushed or pushy.',
    'The estimate feels informed and defensible, not random.',
    'The customer understands the next step and why it matters.',
    'The handoff into operations stays clean because sales captured the right details.',
  ],
}

export const SALES_READ_FIRST_FIRST_SHIFT: ReadFirstSection = {
  title: 'Before First Live Calls',
  items: [
    'Read this page so you understand the business and the brand standard.',
    'Complete the required academy path so you know the STAR framework and pricing rules.',
    'Listen to strong and weak examples in the tonality work before taking live traffic.',
    'Practice preferred phrases so you are not searching for words on live calls.',
    'Know the branch footprint, restricted-item rules, and what requires manager review.',
  ],
}

export const SALES_READ_FIRST_PROMISES: ReadFirstCard[] = [
  {
    title: 'Clarity over confusion',
    body: 'Customers should not have to guess what happens next, what the pricing means, or what we need from them.',
  },
  {
    title: 'Warmth over robotic scripts',
    body: 'The process stays structured, but the delivery should still feel human, reassuring, and natural.',
  },
  {
    title: 'Trust over tricks',
    body: 'We explain what helps the customer make a decision. We do not hide minimums, dodge questions, or use fake urgency.',
  },
]
