export type AcademyLessonType = 'card' | 'acronym' | 'scenario' | 'flashcards' | 'video' | 'practice'

export interface AcademyResourceLink {
  label: string
  href: string
}

export interface AcademyFlashcard {
  id: string
  front: string
  back: string
  tag?: string
}

export interface AcademyScenarioOption {
  id: string
  label: string
  outcome: string
  coachingNote: string
  isBest?: boolean
}

export interface AcademyScenario {
  customerLine: string
  setup: string
  prompt: string
  options: AcademyScenarioOption[]
}

export interface AcademyAcronymStep {
  letter: string
  title: string
  summary: string
  talkTrack?: string
}

export interface AcademyPracticePrompt {
  id: string
  title: string
  targetLine: string
  strongExample?: string
  weakExample?: string
  coachingFocus: string[]
}

export interface AcademyPracticeLesson {
  intro: string
  checklist: string[]
  prompts: AcademyPracticePrompt[]
  outro?: string
}

export interface AcademyModuleSection {
  id: string
  title: string
  shortTitle?: string
  summary: string
}

export interface AcademyLesson {
  id: string
  sectionId?: string
  type: AcademyLessonType
  title: string
  summary: string
  points?: string[]
  steps?: AcademyAcronymStep[]
  scenario?: AcademyScenario
  flashcards?: AcademyFlashcard[]
  practice?: AcademyPracticeLesson
  videoUrl?: string | null
  videoPlaceholder?: string
}

export interface AcademyModule {
  id: string
  title: string
  badge: string
  description: string
  objective: string
  estimatedMinutes: number
  required: boolean
  version: string
  updatedAt: string
  audience: string[]
  resources: AcademyResourceLink[]
  sections?: AcademyModuleSection[]
  lessons: AcademyLesson[]
}

export interface AcademyReleaseNote {
  id: string
  version: string
  title: string
  publishedAt: string
  points: string[]
}

export const SALES_ACADEMY_RELEASES: AcademyReleaseNote[] = [
  {
    id: 'academy-r6',
    version: '2026.05.5',
    title: 'STAR course rebuilt into a section-based training path',
    publishedAt: '2026-05-02',
    points: [
      'Rebuilt STAR into structured sections for foundation, tone, control, assessment, closing, and follow-up.',
      'Added more drills, practice prompts, and scenario training so STAR feels like a real training path instead of a flat lesson list.',
      'Prepared the academy player for section tabs and more immersive course flow.',
    ],
  },
  {
    id: 'academy-r5',
    version: '2026.05.4',
    title: 'Read First, tonality lab, and phrase bank added',
    publishedAt: '2026-05-01',
    points: [
      'Added a separate Read First business page so reps understand the Saturn Star brand and standards before entering course work.',
      'Added a tonality module with opener examples, practice prompts, and self-record drills reps can use in the browser.',
      'Added a phrase-bank module for tone-setting, guided control, empathy, urgency, and tentative reservation language.',
    ],
  },
  {
    id: 'academy-r4',
    version: '2026.05.3',
    title: 'Listening-control and default-exclusion coaching added',
    publishedAt: '2026-05-01',
    points: [
      'Refined STAR training so "take control" now explicitly means guiding the call without talking over the customer.',
      'Added coaching for confidence, price discipline, assumptive closing, and tentative reservation follow-through.',
      'Expanded estimate-builder training around items that stay excluded by default unless the customer clearly confirms they are moving them.',
    ],
  },
  {
    id: 'academy-r3',
    version: '2026.05.2',
    title: 'Restricted-item and branch-trust drills added',
    publishedAt: '2026-05-01',
    points: [
      'Added a clear training card for items Saturn Star does not move and what requires management review.',
      'Added a trust scenario for customers who question whether the rep is really local to Kitchener-Waterloo, Ottawa, or Windsor.',
      'Expanded estimate-builder coaching so reps can explain MLS access, branch coverage, and restricted scope more confidently.',
    ],
  },
  {
    id: 'academy-r2',
    version: '2026.05.1',
    title: 'MLS trust-handling scenarios added',
    publishedAt: '2026-05-01',
    points: [
      'Added two new objection drills for customers who feel uneasy that Saturn Star can already see listing inventory.',
      'Added a sold-listing trust scenario so reps can explain archived listing access without sounding evasive or creepy.',
      'Expanded the estimate-builder course so MLS-based quoting feels more polished and safer on live calls.',
    ],
  },
  {
    id: 'academy-r1',
    version: '2026.05',
    title: 'Sales Academy launched inside Mission Control',
    publishedAt: '2026-05-01',
    points: [
      'Added the first in-app academy structure for reps, managers, and owner review.',
      'Seeded live training on STAR, quoting, closing, fast-lane billing, CRM rhythm, and call review.',
      'Prepared the page for future Loom or YouTube walkthrough videos without changing the training structure again.',
    ],
  },
]

export const SALES_ACADEMY_MODULES: AcademyModule[] = [
  {
    id: 'star-framework',
    title: 'STAR Call Framework',
    badge: 'Required',
    description: 'This is the main call system. Reps should move through the call in sections instead of freelancing the conversation.',
    objective: 'Reps should set tone, guide the call, diagnose the move, recommend the lane, and lock a clean next step without sounding robotic.',
    estimatedMinutes: 52,
    required: true,
    version: '2026.05.5',
    updatedAt: '2026-05-02',
    audience: ['Sales Rep', 'Manager', 'Owner'],
    resources: [
      { label: 'Open Read First', href: '/sales/read-first' },
      { label: 'Open Team Handbook', href: '/SOPs/mission-control-team-handbook.html' },
      { label: 'Open System Map', href: '/SOPs/mission-control-map.html' },
    ],
    sections: [
      {
        id: 'star-foundation',
        title: 'Foundation',
        shortTitle: 'Foundation',
        summary: 'Understand the system before trying to improvise with style.',
      },
      {
        id: 'set-tone',
        title: 'Set Tone',
        shortTitle: 'Tone',
        summary: 'Train how the first 10 seconds should sound and what physical setup supports that.',
      },
      {
        id: 'take-control',
        title: 'Take Control',
        shortTitle: 'Control',
        summary: 'Lead the structure without overpowering the customer.',
      },
      {
        id: 'assess',
        title: 'Assess',
        shortTitle: 'Assess',
        summary: 'Diagnose the route, scope, risk, and move details like a consultant.',
      },
      {
        id: 'recommend-close',
        title: 'Recommend and Close',
        shortTitle: 'Close',
        summary: 'Present the lane clearly, create value, and move to a commitment step.',
      },
      {
        id: 'follow-up',
        title: 'Follow-Up',
        shortTitle: 'Follow-Up',
        summary: 'Treat post-quote follow-up as part of the sale instead of an afterthought.',
      },
    ],
    lessons: [
      {
        id: 'system-before-talent',
        sectionId: 'star-foundation',
        type: 'card',
        title: 'System before talent',
        summary: 'Mission Control is not built around waiting for naturally gifted closers. The system is supposed to make average reps productive and strong reps elite.',
        points: [
          'Do not let reps improvise the call structure.',
          'Do not chase personality before you have process compliance.',
          'Judge whether the rep followed the framework before judging whether they closed the job.',
          'If results are weak but structure is strong, coach the talk track. If structure is weak, fix the system first.',
        ],
      },
      {
        id: 'star-breakdown',
        sectionId: 'star-foundation',
        type: 'acronym',
        title: 'S.T.A.R.',
        summary: 'One simple framework for almost every move call.',
        steps: [
          {
            letter: 'S',
            title: 'Set tone',
            summary: 'Open with energy, calmness, and confidence. No lazy greetings, no confusion, and no dead air.',
            talkTrack: 'Saturn Star Movers, John speaking. How can I help you today?',
          },
          {
            letter: 'T',
            title: 'Take control',
            summary: 'Guide the process without stepping on the customer. You are leading the call, not competing to talk more.',
            talkTrack: 'Perfect, I can help with that. Let me ask you a few quick questions so I can give you an accurate quote.',
          },
          {
            letter: 'A',
            title: 'Assess',
            summary: 'Confirm move date, route, inventory, access, concerns, and special items before giving numbers.',
            talkTrack: 'Just so I can quote this properly, what are we moving from, what are we moving to, and what does the inventory look like?',
          },
          {
            letter: 'R',
            title: 'Recommend and close',
            summary: 'Position the solution, explain the why, then roll into a reservation or next commitment.',
            talkTrack: 'Based on what you told me, this is what I would recommend for your move.',
          },
        ],
      },
      {
        id: 'how-to-work-star',
        sectionId: 'star-foundation',
        type: 'card',
        title: 'How to work this course',
        summary: 'This is supposed to feel like drills, not just reading.',
        points: [
          'Work the sections in order instead of bouncing around the course.',
          'Repeat the practice lessons out loud. Silent reading does not build live-call ability.',
          'Managers should roleplay from the section the rep just failed on a real call.',
          'The goal is repeatable behavior under pressure, not one clean read-through.',
        ],
      },
      {
        id: 'set-tone-first-impression',
        sectionId: 'set-tone',
        type: 'card',
        title: 'Set tone in the first 10 seconds',
        summary: 'Before the quote, before the inventory, and before the close, the customer decides whether this rep sounds safe and competent.',
        points: [
          'Strong tone sounds awake, calm, audible, and grounded.',
          'Weak tone sounds flat, rushed, unsure, or like the rep wants the call to end.',
          'The goal is not hype. The goal is calm authority with life in the voice.',
          'Set tone is the first trust move in the entire sales process.',
        ],
      },
      {
        id: 'tone-physical-setup',
        sectionId: 'set-tone',
        type: 'card',
        title: 'Physical setup changes the voice',
        summary: 'A distracted body usually creates a distracted voice.',
        points: [
          'Sit down, face the screen, and keep the laptop or notes in front of you before picking up the call.',
          'Take one breath before answering so the first sentence lands cleanly.',
          'Open your mouth and project. Do not mumble into the headset.',
          'Talk like you are speaking to a real person you want to help, not like you are reading from a script.',
          'Posture, pace, and breathing are part of tone training, not separate from it.',
        ],
      },
      {
        id: 'tone-contrast-video',
        sectionId: 'set-tone',
        type: 'video',
        title: 'Strong tone vs flat tone examples',
        summary: 'This slot is for the good-vs-bad contrast examples reps should replay before shifts.',
        points: [
          'Add one flat monotone opener and one strong opener so reps can hear the difference immediately.',
          'Add one rushed guided-control line and one calm guided-control line.',
          'Add one fake-sounding empathy clip and one sincere empathy clip.',
        ],
        videoUrl: null,
        videoPlaceholder: 'Drop short audio or Loom examples here for tone contrast training.',
      },
      {
        id: 'set-tone-practice',
        sectionId: 'set-tone',
        type: 'practice',
        title: 'Set tone drills',
        summary: 'Practice the greeting, the transition, and the reassurance out loud.',
        practice: {
          intro: 'These are first-contact drills. Record them, listen back, and check whether you sound warm, awake, and in control.',
          checklist: [
            'Did the first line sound like a professional answered the phone?',
            'Did the sentence land cleanly or fade out at the end?',
            'Did you sound calm instead of rushed?',
            'Would this voice make a customer comfortable giving you move details?',
          ],
          prompts: [
            {
              id: 'star-tone-opener',
              title: 'Greeting',
              targetLine: 'Saturn Star Movers, John speaking. How can I help you today?',
              strongExample: 'Clean, warm, and slightly lifted. It sounds like the rep is ready for the call.',
              weakExample: 'Low-energy, rushed, or flat. It sounds like the rep is half awake.',
              coachingFocus: ['Warmth', 'Clarity', 'Energy'],
            },
            {
              id: 'star-tone-transition',
              title: 'Transition into structure',
              targetLine: 'Perfect, I can help with that. Let me ask you a few quick questions so I can quote this properly.',
              strongExample: 'Guiding and confident. The customer should feel the rep knows the road map.',
              weakExample: 'Bossy, clipped, or defensive. It sounds like the rep is pushing instead of leading.',
              coachingFocus: ['Control', 'Pace', 'Authority'],
            },
            {
              id: 'star-tone-reassurance',
              title: 'Human reassurance',
              targetLine: 'I know moving can be a lot. We will make this part easier for you.',
              strongExample: 'Steady and reassuring without sounding cheesy.',
              weakExample: 'Overacted or emotionless. It feels fake either way.',
              coachingFocus: ['Sincerity', 'Calm pace', 'Reassurance'],
            },
          ],
          outro: 'If this still sounds flat, move into Tonality Lab next. STAR gives the frame. Tonality Lab sharpens the voice.',
        },
      },
      {
        id: 'guided-control-card',
        sectionId: 'take-control',
        type: 'card',
        title: 'Control by guiding, not by overpowering',
        summary: 'Strong reps do not one-up the customer. They listen first, then steer with structure.',
        points: [
          'Let the customer finish their first useful burst instead of cutting them off too early.',
          'Mirror the key point back in one short sentence so they feel heard, then guide the next question.',
          'Take control means you own the structure, not that you do all the talking.',
          'If the customer is already giving good information, use it. Do not force your next question over their sentence just because it is in your head.',
          'A calm redirect sounds stronger than a hard interruption.',
        ],
      },
      {
        id: 'listening-is-control',
        sectionId: 'take-control',
        type: 'card',
        title: 'Listening is part of taking control',
        summary: 'The rep leads the frame of the conversation. That does not mean the rep should dominate the airtime.',
        points: [
          'Let the customer give their first useful burst of information before redirecting.',
          'Confirm the important part back in one sentence so they feel heard.',
          'Then move them to the next missing variable instead of asking random questions.',
          'Good control feels like guidance. Bad control feels like interruption.',
        ],
      },
      {
        id: 'star-scenario',
        sectionId: 'take-control',
        type: 'scenario',
        title: 'Scenario: customer wants a price instantly',
        summary: 'Use the structure without sounding robotic.',
        scenario: {
          customerLine: 'Can you just give me a quick price right now?',
          setup: 'The customer is impatient and wants a number before giving details.',
          prompt: 'What is the best next move?',
          options: [
            {
              id: 'price-first',
              label: 'Give a rough number immediately so they do not hang up.',
              outcome: 'You may keep them on the line for a second, but you lose control and risk quoting the wrong move.',
              coachingNote: 'Never let urgency force you into blind pricing.',
            },
            {
              id: 'take-control',
              label: 'Acknowledge the ask, then explain you need a few quick details to quote accurately.',
              outcome: 'Correct. You kept control, protected the estimate, and moved the customer into your structure.',
              coachingNote: 'This is the exact moment the rep must sound like a professional consultant.',
              isBest: true,
            },
            {
              id: 'ask-to-call-back',
              label: 'Tell them to send details later and call back when ready.',
              outcome: 'You just created friction and likely lost the lead.',
              coachingNote: 'If the lead is live now, work the lead now.',
            },
          ],
        },
      },
      {
        id: 'listen-then-guide-scenario',
        sectionId: 'take-control',
        type: 'scenario',
        title: 'Scenario: the customer starts explaining the move in detail',
        summary: 'Take control without talking over them.',
        scenario: {
          customerLine: 'So we are moving from a townhouse in Kitchener, there are boxes in the basement, a dresser upstairs, and I am not even sure if we are taking the washer and dryer yet...',
          setup: 'The customer is already giving useful information, but the rep also wants structure.',
          prompt: 'What is the strongest rep move?',
          options: [
            {
              id: 'interrupt-fast',
              label: 'Cut them off immediately and force your question order from the top.',
              outcome: 'You may get your structure back, but you damage flow and can sound pushy.',
              coachingNote: 'Control is not the same as interruption.',
            },
            {
              id: 'let-them-ramble-forever',
              label: 'Say nothing and let them ramble without ever steering the call.',
              outcome: 'That sounds polite, but you lose structure and miss the estimate path.',
              coachingNote: 'Listening without guidance is not control either.',
            },
            {
              id: 'listen-then-steer',
              label: 'Let them finish the useful thought, confirm the key points back, then guide them into the next missing piece.',
              outcome: 'Correct. You listened, kept rapport, and still controlled the structure.',
              coachingNote: 'Best language sounds like: "Perfect, that helps. So I have Kitchener townhouse, basement boxes, and upstairs furniture. Let me confirm the appliances next so I quote this properly."',
              isBest: true,
            },
          ],
        },
      },
      {
        id: 'assess-like-consultant',
        sectionId: 'assess',
        type: 'card',
        title: 'Assess like a consultant, not a guesser',
        summary: 'The rep is not just collecting random details. The rep is diagnosing the exact shape of the move.',
        points: [
          'Think like a doctor: what is the route, what is the inventory, what is the access, what are the risks, and what are the customer instructions?',
          'Every question should reduce pricing uncertainty or operational surprise.',
          'Assess is the bulk of the real work. Weak assessment creates weak quotes and weak closes.',
          'If the move is unusual, slow down and map the situation instead of forcing a normal script.',
        ],
      },
      {
        id: 'assess-diagnostic-flashcards',
        sectionId: 'assess',
        type: 'flashcards',
        title: 'Assessment lanes',
        summary: 'These are the recurring cases reps must know how to map.',
        flashcards: [
          { id: 'star-assess-1', tag: 'Route', front: 'What are the first route facts?', back: 'Move date, origin, destination, whether it is local or long distance, and whether there are extra stops.' },
          { id: 'star-assess-2', tag: 'Inventory', front: 'What makes inventory assessment strong?', back: 'Room-by-room anchors, specialty items, default exclusions, and confirmation of what is actually going.' },
          { id: 'star-assess-3', tag: 'Access', front: 'What access issues matter before pricing?', back: 'Stairs, elevators, loading distance, parking, condo rules, basements, and storage layout.' },
          { id: 'star-assess-4', tag: 'Custom', front: 'What custom situations change the quote path?', back: 'No move date yet, storage, two pickup locations, sold listing, specialty items, or uncertain appliances.' },
        ],
      },
      {
        id: 'assess-tools-and-crm',
        sectionId: 'assess',
        type: 'card',
        title: 'Assess using the tools, not just memory',
        summary: 'The MLS path, survey path, photos, and CRM context are part of the assessment process.',
        points: [
          'Use MLS and listing scans when they speed up the inventory estimate, but still confirm details out loud.',
          'If the listing is weak or unavailable, switch to photos, survey, or live walkthrough instead of guessing.',
          'Use the CRM to capture what the next human will need, not just what helps you in the moment.',
          'Assessment inside the software should feel like guided consulting, not admin work.',
        ],
      },
      {
        id: 'no-date-yet-scenario',
        sectionId: 'assess',
        type: 'scenario',
        title: 'Scenario: the customer does not have a date yet',
        summary: 'A missing date changes the lane, but it does not kill the sale.',
        scenario: {
          customerLine: 'We do not even have the closing date yet. We just want to know what this will look like.',
          setup: 'The customer still needs guidance even though the move date is not locked.',
          prompt: 'What is the strongest rep move?',
          options: [
            {
              id: 'refuse-until-date',
              label: 'Tell them to call back only when the date is confirmed.',
              outcome: 'You protected yourself, but you lost momentum and probably lost the lead.',
              coachingNote: 'No date yet does not mean no sale path.',
            },
            {
              id: 'estimate-and-anchor',
              label: 'Give the estimate lane based on the current scope, explain what could change, and set a follow-up or tentative path around the date.',
              outcome: 'Correct. You kept the lead alive and created a next step instead of waiting passively.',
              coachingNote: 'Use language like: "I can map the move for you now, then we tighten the date and slot once that piece is locked in."',
              isBest: true,
            },
            {
              id: 'fake-date',
              label: 'Guess a date in the system just so you can move on.',
              outcome: 'That creates bad records and bad follow-up.',
              coachingNote: 'Do not solve uncertainty by inventing facts.',
            },
          ],
        },
      },
      {
        id: 'storage-two-stop-scenario',
        sectionId: 'assess',
        type: 'scenario',
        title: 'Scenario: storage plus another pickup',
        summary: 'Unusual scope should trigger deeper assessment, not a faster quote.',
        scenario: {
          customerLine: 'Some things are in storage, some things are at my current place, and a few things might come from another family house too.',
          setup: 'This is not a simple A-to-B move anymore.',
          prompt: 'What is the best rep move?',
          options: [
            {
              id: 'price-like-normal',
              label: 'Quote it like a normal single-origin move and hope ops can figure it out later.',
              outcome: 'That creates downstream arguments and broken margins.',
              coachingNote: 'Complex route means deeper assessment now, not later.',
            },
            {
              id: 'map-stops-carefully',
              label: 'Slow down, map each origin, confirm access at each stop, and explain that the route and labor plan depend on the full sequence.',
              outcome: 'Correct. You treated the move like a real consulting problem instead of flattening it.',
              coachingNote: 'Use words like: "Let me map the stops cleanly so I build the right route and labor plan for you."',
              isBest: true,
            },
            {
              id: 'send-form-only',
              label: 'Push them to fill a form later instead of working the live call.',
              outcome: 'That can be useful as support, but it should not replace live control on a warm call.',
              coachingNote: 'Use forms to support the call, not avoid it.',
            },
          ],
        },
      },
      {
        id: 'recommend-like-a-pro',
        sectionId: 'recommend-close',
        type: 'card',
        title: 'Recommend like a professional mover',
        summary: 'After the assessment, the rep should sound like the answer is clear, not like they are nervously presenting a guess.',
        points: [
          'Recommend crew size, truck count, hours, and service lane based on the assessment you just completed.',
          'Explain why the recommendation fits the route, inventory, access, and special conditions.',
          'Do not sound apologetic about correct pricing. Sound calm and certain.',
          'The customer should hear that you are solving the move, not just offering a number.',
        ],
      },
      {
        id: 'small-talk-bridges',
        sectionId: 'recommend-close',
        type: 'card',
        title: 'Use small talk as a bridge, not a detour',
        summary: 'Human moments help trust, but they should feed the close instead of stealing the call.',
        points: [
          'Acknowledge life context briefly, then steer back into the move plan.',
          'If they mention a new job, a baby, stress, or a loss, that is a trust moment, not a chance to ramble.',
          'Compliments can work if they are short and real: nice home, exciting transition, or empathy for a hard moment.',
          'Good small talk buys trust and then hands the call back to structure.',
        ],
      },
      {
        id: 'tentative-reservation-scenario',
        sectionId: 'recommend-close',
        type: 'scenario',
        title: 'Scenario: customer wants to review the quote first',
        summary: 'This is where the rep should create a protected next step instead of floating away.',
        scenario: {
          customerLine: 'Okay, send it over. I just want to review it first.',
          setup: 'The customer is interested, but not committed yet.',
          prompt: 'What is the strongest next move?',
          options: [
            {
              id: 'just-send',
              label: 'Send the quote and wait for them to come back whenever they are ready.',
              outcome: 'That leaves the deal hanging with no structure.',
              coachingNote: 'The send is not the close. The next step is the close move.',
            },
            {
              id: 'send-and-hold',
              label: 'Send the quote, explain the timeline, and offer a tentative reservation or a scheduled follow-up point.',
              outcome: 'Correct. You kept control and gave the customer a safe next step.',
              coachingNote: 'Use a line like: "I will send it now, and if you want I can tentatively note the slot while you review it so you are not starting from scratch later."',
              isBest: true,
            },
            {
              id: 'pressure-deposit',
              label: 'Push directly for payment before they even review the details.',
              outcome: 'That can make the rep sound rushed and self-serving.',
              coachingNote: 'Lead to commitment, but do not skip the customer need for clarity.',
            },
          ],
        },
      },
      {
        id: 'close-practice',
        sectionId: 'recommend-close',
        type: 'practice',
        title: 'Close drills',
        summary: 'Practice the transition from recommendation into reservation language.',
        practice: {
          intro: 'These are close-control drills. You are practicing price confidence and next-step language, not pressure.',
          checklist: [
            'Did you explain the lane before asking for the next step?',
            'Did you sound calm about the price instead of apologetic?',
            'Did you move into a real commitment path or just end politely?',
            'Would the customer clearly know what happens next?',
          ],
          prompts: [
            {
              id: 'star-close-recommend',
              title: 'Recommendation line',
              targetLine: 'Based on everything you told me, this is the lane I would recommend for your move.',
              strongExample: 'Steady and decisive. It sounds like a consultant giving the right answer.',
              weakExample: 'Tentative or apologetic. It sounds like the rep does not trust the recommendation.',
              coachingFocus: ['Authority', 'Calm pace', 'Clarity'],
            },
            {
              id: 'star-close-hold',
              title: 'Tentative hold line',
              targetLine: 'If you want, I can tentatively hold that slot while you review the estimate so you are not starting from scratch later.',
              strongExample: 'Helpful and structured. It sounds like a service move, not a pressure move.',
              weakExample: 'Pushy or timid. It either feels forceful or too weak to matter.',
              coachingFocus: ['Control', 'Service tone', 'Commitment'],
            },
          ],
          outro: 'If the rep cannot say these lines cleanly, the close will feel shaky on live calls.',
        },
      },
      {
        id: 'followup-is-still-selling',
        sectionId: 'follow-up',
        type: 'card',
        title: 'Follow-up is still part of the close',
        summary: 'Once the quote is out, the rep is not done. The next move is still a sales move.',
        points: [
          'Every follow-up should be tied to timing, decision support, or slot protection.',
          'Do not send vague "just checking in" messages when the real goal is commitment.',
          'Silence after the quote is usually where weak reps disappear and disciplined reps win.',
          'A follow-up should feel like controlled progression, not random chasing.',
        ],
      },
      {
        id: 'quote-quiet-scenario',
        sectionId: 'follow-up',
        type: 'scenario',
        title: 'Scenario: quote sent, customer went quiet',
        summary: 'Use the follow-up to move the deal, not to look busy.',
        scenario: {
          customerLine: 'No reply yet. The quote was sent yesterday and the customer has gone quiet.',
          setup: 'The lead is still warm, but the rep needs a real next move.',
          prompt: 'What is the strongest action?',
          options: [
            {
              id: 'wait-passively',
              label: 'Wait a few more days so you do not seem pushy.',
              outcome: 'That is how warm leads go stale.',
              coachingNote: 'Silence is usually the cue for controlled follow-up, not passivity.',
            },
            {
              id: 'direct-followup',
              label: 'Follow up with the quote context, ask what is left for them to decide, and offer the next step or hold.',
              outcome: 'Correct. That keeps the conversation alive and pushes toward commitment.',
              coachingNote: 'A good follow-up sounds like a continuation of the sale, not a random reminder.',
              isBest: true,
            },
            {
              id: 'rebuild-quote',
              label: 'Make a brand new quote and resend it without context.',
              outcome: 'That creates more noise than progress.',
              coachingNote: 'Work the live quote unless the scope actually changed.',
            },
          ],
        },
      },
      {
        id: 'star-video-slot',
        sectionId: 'follow-up',
        type: 'video',
        title: 'Manager walkthrough slot',
        summary: 'Use this slot for a manager-led STAR walkthrough from greeting to follow-up.',
        points: [
          'Record one full estimate call and pause at the tone, control, assess, and close moments.',
          'Show one example of follow-up after the quote is sent.',
          'Keep the walkthrough practical so reps can replay it before live shifts.',
        ],
        videoUrl: null,
        videoPlaceholder: 'Paste a manager STAR walkthrough here in the next release.',
      },
    ],
  },
  {
    id: 'estimate-builder',
    title: 'Estimate Builder',
    badge: 'Required',
    description: 'This module trains reps to gather the information that makes the quote accurate, defensible, and easier to close.',
    objective: 'Reps should capture contact details, route, inventory, access conditions, and upsells before sending a quote.',
    estimatedMinutes: 28,
    required: true,
    version: '2026.05.2',
    updatedAt: '2026-05-01',
    audience: ['Sales Rep', 'Manager'],
    resources: [
      { label: 'Open Leads Workspace', href: '/sales/leads' },
      { label: 'Open Quote Workspace', href: '/sales/quotes' },
    ],
    lessons: [
      {
        id: 'capture-before-quote',
        type: 'card',
        title: 'Capture before quote',
        summary: 'No rep should ever deliver an estimate without first capturing the customer name, phone, and email.',
        points: [
          'Phone number is your recovery path if the call drops.',
          'Email is how the quote, agreement, and follow-up stay alive after the call.',
          'If you quote first and they disappear, you created work without creating pipeline.',
          'Use a reason when asking: "I want to send you everything we discuss plus the estimate in writing."',
        ],
      },
      {
        id: 'estimate-flashcards',
        type: 'flashcards',
        title: 'Core estimate flashcards',
        summary: 'These are the minimum questions every rep should ask.',
        flashcards: [
          { id: 'fc-move-date', tag: 'Route', front: 'What do I confirm before I talk pricing?', back: 'Move date, origin, destination, inventory size, access issues, and special items.' },
          { id: 'fc-upsells', tag: 'Upsell', front: 'What 3 upsell paths must I ask on every call?', back: 'Packing help, junk removal, and specialty items like piano, safe, gym equipment, or fragile items.' },
          { id: 'fc-mls', tag: 'MLS', front: 'When should I use the MLS or listing scan path?', back: 'Any house or condo where listing photos can help estimate furniture and room count faster.' },
          { id: 'fc-photos', tag: 'Fallback', front: 'What is the fallback when inventory is unclear?', back: 'Guide them through rooms, request photos, or offer a quick walkthrough instead of guessing.' },
        ],
      },
      {
        id: 'inventory-scenario',
        type: 'scenario',
        title: 'Scenario: customer does not know the inventory',
        summary: 'Guide the lead. Do not let uncertainty freeze the quote.',
        scenario: {
          customerLine: 'I do not really know what is all going. I just know it is a two-bedroom place.',
          setup: 'The customer is not organized and cannot list every item cleanly.',
          prompt: 'What is the best rep move?',
          options: [
            {
              id: 'guess-size',
              label: 'Guess the move size from the bedroom count and send something anyway.',
              outcome: 'You might move fast, but you make the quote fragile and create argument risk later.',
              coachingNote: 'Bedroom count helps, but it is not inventory.',
            },
            {
              id: 'guided-walkthrough',
              label: 'Walk room by room, ask anchor items, then request photos or a follow-up walkthrough if needed.',
              outcome: 'Correct. You kept momentum while protecting estimate quality.',
              coachingNote: 'Structured guidance beats pressure or guessing.',
              isBest: true,
            },
            {
              id: 'end-call',
              label: 'Tell them to call back after they figure it out themselves.',
              outcome: 'That creates needless friction and loses warm leads.',
              coachingNote: 'Reps are supposed to reduce thinking for the customer.',
            },
          ],
        },
      },
      {
        id: 'mls-photo-path',
        type: 'card',
        title: 'MLS and photo path',
        summary: 'Use the tools to speed up the estimate, but still confirm details out loud.',
        points: [
          'If the listing exists, tell the customer you are pulling it up so the estimate feels informed, not random.',
          'If no listing exists, move to photos or a live walkthrough quickly.',
          'AI or listing photos help estimate furniture, but the rep still owns the confirmation.',
          'Mention specialty items, parking, elevators, stairs, and access separately even if the listing looks simple.',
        ],
      },
      {
        id: 'mls-creepy-scenario',
        type: 'scenario',
        title: 'Scenario: customer feels weird that we already see the inventory',
        summary: 'Reassure them without sounding defensive, invasive, or robotic.',
        scenario: {
          customerLine: 'Wait, how do you already know what is in my house? That feels kind of weird.',
          setup: 'The rep used the MLS path well, but the customer is surprised that Saturn Star can already estimate furniture from listing photos.',
          prompt: 'What is the best rep response?',
          options: [
            {
              id: 'brush-it-off',
              label: 'Laugh it off and say not to worry because the AI already knows what is there.',
              outcome: 'That makes the moment feel more invasive, not safer.',
              coachingNote: 'Never sound casual about privacy when the customer is already uneasy.',
            },
            {
              id: 'trust-build',
              label: 'Explain that our system uses listing photos to build a starting estimate so we can save them time, then confirm the inventory with them live before anything is finalized.',
              outcome: 'Correct. You made the tool sound helpful, transparent, and still customer-controlled.',
              coachingNote: 'Best language sounds like: "Our system uses the listing photos as a starting point so we can save you time and build a more accurate estimate, but I still confirm everything with you live before we lock anything in."',
              isBest: true,
            },
            {
              id: 'deny-mls',
              label: 'Backpedal and pretend you did not actually use the listing photos.',
              outcome: 'That damages trust because the customer can already tell you have more context than a normal cold quote.',
              coachingNote: 'Be transparent. Do not hide the process once the customer asks.',
            },
          ],
        },
      },
      {
        id: 'sold-listing-scenario',
        type: 'scenario',
        title: 'Scenario: the customer says the house is already sold',
        summary: 'Handle the archive question calmly and professionally.',
        scenario: {
          customerLine: 'But that listing is sold already. How do you still have access to it?',
          setup: 'The customer is not accusing the rep of wrongdoing, but they need a clean explanation for why Saturn Star still has listing context.',
          prompt: 'What should the rep say?',
          options: [
            {
              id: 'vague-access',
              label: 'Say the system just keeps everything forever and move on.',
              outcome: 'That sounds loose and unprofessional.',
              coachingNote: 'If the answer feels sloppy, the customer starts inventing risk.',
            },
            {
              id: 'archive-explain',
              label: 'Explain that once a listing has been captured in our system, we may still have the archived photos and details on file so we can quote faster and then confirm everything with them directly.',
              outcome: 'Correct. You answered the concern clearly without sounding evasive.',
              coachingNote: 'Best language sounds like: "Once a listing has been captured in our system, we may still have the photos and details archived on file. It just helps us give you a faster and more accurate starting quote, and then I confirm the details with you directly."',
              isBest: true,
            },
            {
              id: 'skip-question',
              label: 'Ignore the question and go straight back to price.',
              outcome: 'That leaves the trust objection open and makes the quote harder to close.',
              coachingNote: 'When trust is the issue, price is not the next step.',
            },
          ],
        },
      },
      {
        id: 'restricted-items-card',
        type: 'card',
        title: 'Things Saturn Star does not move',
        summary: 'The rep should know the hard scope boundaries before pricing confidently.',
        points: [
          'Hot tubs and pool tables are outside scope. Do not include them in the quote. Refer the customer to a specialty mover if needed.',
          'Hazardous / non-transport items like propane tanks, fuel cans, fireworks, oxygen tanks, and chemical containers must be removed by the customer before move day.',
          'Commercial equipment is not standard residential scope. Server racks, copiers, restaurant equipment, and similar items need management review first.',
          'Safes require photo confirmation, weight/access review, and specialty pricing before the move is finalized.',
          'If the system flags something, the rep still confirms it out loud with the customer before sending the quote.',
        ],
      },
      {
        id: 'default-exclusions-card',
        type: 'card',
        title: 'Excluded by default is not the same as "never moving"',
        summary: 'Some items stay out of the inventory by default until the customer clearly confirms they are going.',
        points: [
          'Bathroom vanities, stoves, cookers, dishwashers, washers, dryers, fridges, and similar fixtures or appliances should stay excluded by default.',
          'If the customer is actually taking one of those items, the rep can include it back instead of rebuilding the inventory from scratch.',
          'This protects the quote from AI overcounting normal stay-behind fixtures.',
          'Always say it out loud when it matters: "By default I am leaving the appliances and built-ins out unless you are taking them."',
        ],
      },
      {
        id: 'branch-trust-scenario',
        type: 'scenario',
        title: 'Scenario: the customer questions whether you are really local',
        summary: 'Handle branch trust questions cleanly when the caller ID does not look local.',
        scenario: {
          customerLine: 'Are you actually based in Kitchener? The number calling me does not even look local.',
          setup: 'The customer is checking whether Saturn Star is actually operating in their market before trusting the quote.',
          prompt: 'What is the best rep response?',
          options: [
            {
              id: 'defensive-answer',
              label: 'Tell them not to worry about the number and jump back to price.',
              outcome: 'That makes the concern feel dismissed and keeps the trust objection open.',
              coachingNote: 'When someone questions whether you are really local, do not brush it off.',
            },
            {
              id: 'clear-branch-answer',
              label: 'Explain that Saturn Star actively serves Windsor, Kitchener-Waterloo, and Ottawa, and that the number they see can depend on the branch line or routing setup for that market.',
              outcome: 'Correct. You answered the concern directly and made the business sound organized instead of evasive.',
              coachingNote: 'Best language sounds like: "Yes, we actively handle moves in Kitchener-Waterloo, Ottawa, and Windsor. The number you see can depend on the branch line or routing setup we are using, but your move is being handled inside that market."',
              isBest: true,
            },
            {
              id: 'over-explain-phone',
              label: 'Start explaining telephony tools and internal call routing in detail.',
              outcome: 'That is too technical and sounds strange to a customer.',
              coachingNote: 'Give reassurance, not infrastructure diagrams.',
            },
          ],
        },
      },
    ],
  },
  {
    id: 'closing-playbook',
    title: 'Closing Playbook',
    badge: 'Required',
    description: 'This is where reps learn how to move from quote delivery into commitment instead of drifting into vague follow-up.',
    objective: 'Reps should know how to handle hesitation, price shopping, partner approval, and the difference between tentative and firm booking.',
    estimatedMinutes: 24,
    required: true,
    version: '2026.05.3',
    updatedAt: '2026-05-01',
    audience: ['Sales Rep', 'Manager', 'Owner'],
    resources: [
      { label: 'Open Pipeline', href: '/sales/pipeline' },
      { label: 'Open Reps Dashboard', href: '/sales/reps' },
    ],
    lessons: [
      {
        id: 'five-closing-tactics',
        type: 'card',
        title: 'The five closing tactics',
        summary: 'A close attempt is a structured move, not a random vibe.',
        points: [
          'Tentative reservation: hold the date without forcing a deposit on the spot.',
          'Roll into the reservation: replace yes-or-no with detail questions like card type or time slot.',
          'Authority takeover: escalate stuck higher-value jobs to the manager with full notes.',
          'Tentative to firm: next-day follow-up on tentative reservations is a close attempt, not a soft check-in.',
          'Prepared rebuttals: objections are requests for reassurance, not reasons to go off-script.',
        ],
      },
      {
        id: 'assume-close-card',
        type: 'card',
        title: 'Confidence, price discipline, and assumptive close',
        summary: 'After the assessment, the rep should sound decisive instead of asking permission to help.',
        points: [
          'Recommend the move plan like a professional: crew, trucks, hours, and why it fits.',
          'Stick to the price unless there is a real reason to adjust scope. Do not sound apologetic about correct pricing.',
          'Assume the next step by moving into reservation language: date hold, deposit path, time window, or follow-up commitment.',
          'If they hesitate, diagnose the hesitation before changing the number.',
          'Tentative reservation is not pushy. It is a controlled next step that protects the date while the customer decides.',
        ],
      },
      {
        id: 'think-it-over-scenario',
        type: 'scenario',
        title: 'Scenario: "Let me think about it"',
        summary: 'Do not let the lead disappear without a structured next step.',
        scenario: {
          customerLine: 'Okay, let me think about it and I will get back to you.',
          setup: 'The customer is not rejecting you, but they are about to float away unless you anchor the next move.',
          prompt: 'What should the rep do?',
          options: [
            {
              id: 'soft-thanks',
              label: 'Say thanks and wait for them to call back.',
              outcome: 'That is not follow-up discipline. It is hope.',
              coachingNote: 'Never end a warm lead call without a controlled next step.',
            },
            {
              id: 'tentative-hold',
              label: 'Offer a tentative reservation so the date is protected while they decide.',
              outcome: 'Correct. You reduced friction while keeping the deal alive in your pipeline.',
              coachingNote: 'Tentative reservations are one of the strongest tools in this system.',
              isBest: true,
            },
            {
              id: 'discount-fast',
              label: 'Immediately slash the price before understanding the real hesitation.',
              outcome: 'You gave margin away before diagnosing the objection.',
              coachingNote: 'Discounting is not step one. Diagnose first.',
            },
          ],
        },
      },
      {
        id: 'cheaper-quote-scenario',
        type: 'scenario',
        title: 'Scenario: "Someone else is cheaper"',
        summary: 'Do not panic. Reposition the offer.',
        scenario: {
          customerLine: 'Another company gave me a cheaper quote.',
          setup: 'The customer is inviting comparison. This is a positioning moment.',
          prompt: 'What is the strongest response?',
          options: [
            {
              id: 'match-cheap',
              label: 'Match the cheaper number immediately.',
              outcome: 'You just taught the customer that your original price was unstable.',
              coachingNote: 'Do not collapse your authority on the first pushback.',
            },
            {
              id: 'differentiate',
              label: 'Explain the difference between binding, protected pricing and surprise-fee movers, then continue the close.',
              outcome: 'Correct. You repositioned peace of mind, not just dollars.',
              coachingNote: 'The rep should compare risk, not beg on price.',
              isBest: true,
            },
            {
              id: 'argue',
              label: 'Tell them the other company is probably lying.',
              outcome: 'That sounds defensive and weak.',
              coachingNote: 'Stay calm and professional. Explain differences, do not rant.',
            },
          ],
        },
      },
      {
        id: 'objection-flashcards',
        type: 'flashcards',
        title: 'Objection flashcards',
        summary: 'Quick reps sound prepared because they hear the objection and know the lane.',
        flashcards: [
          { id: 'fc-think', tag: 'Hesitation', front: 'Customer says: "I need to think about it."', back: 'Ask what specifically they need to think through, then offer a tentative reservation and set the next follow-up.' },
          { id: 'fc-partner', tag: 'Partner', front: 'Customer says: "I need to speak with my partner."', back: 'Send the estimate immediately, hold the date tentatively, and ask exactly when the decision will be made.' },
          { id: 'fc-price', tag: 'Price', front: 'Customer says: "It is too expensive."', back: 'Re-anchor the binding protection, insured crew, and no-surprise pricing before discussing any concession.' },
          { id: 'fc-shopping', tag: 'Shopping', front: 'Customer says: "I still have two or three companies to call."', back: 'Offer a tentative reservation so they can shop without losing the date.' },
        ],
      },
    ],
  },
  {
    id: 'fast-lane-billing',
    title: 'Fast Lane and Billing',
    badge: 'Required',
    description: 'This module makes sure reps explain hourly minimums, deposits, balance collection, and invoice paths the same way every time.',
    objective: 'Reps should stop creating avoidable payment arguments by clearly framing minimums, actuals, and next-step payment options.',
    estimatedMinutes: 20,
    required: true,
    version: '2026.05',
    updatedAt: '2026-05-01',
    audience: ['Sales Rep', 'Manager', 'Owner'],
    resources: [
      { label: 'Open Finance', href: '/sales/finance' },
      { label: 'Open Lead Workspace', href: '/sales/leads' },
    ],
    lessons: [
      {
        id: 'billing-models',
        type: 'card',
        title: 'Know the billing model before you speak',
        summary: 'Some arguments are created by reps mixing estimate language. The rep must know whether the quote is binding, hourly actuals, or hourly with a minimum.',
        points: [
          'Fast lane and labor-heavy jobs often use hourly minimum billing, not open-ended improvisation.',
          'If there is a minimum, say it early and say it clearly.',
          'If the customer paid a deposit already, explain what remains after that deposit instead of restating the gross total.',
          'If the payment path changes, the rep should still be able to send a manual invoice from the platform instead of leaving the app.',
        ],
      },
      {
        id: 'minimum-hours-scenario',
        type: 'scenario',
        title: 'Scenario: job finished fast but minimum still applies',
        summary: 'This is the exact kind of conversation that creates avoidable tension when the quote language was weak.',
        scenario: {
          customerLine: 'The move only took about an hour and a half. Why am I still being billed for three hours?',
          setup: 'The quote was a fast-lane job with a three-hour minimum and a deposit already paid.',
          prompt: 'What is the best rep response?',
          options: [
            {
              id: 'argue-minimum',
              label: 'Tell them that is just the policy and move on.',
              outcome: 'You may be technically right, but you sound careless and invite more friction.',
              coachingNote: 'Clarity and empathy matter even when the price is correct.',
            },
            {
              id: 'explain-clearly',
              label: 'Explain the minimum, explain that the deposit is already credited, and restate the remaining balance in plain numbers.',
              outcome: 'Correct. You turned a defensive moment into a clean explanation.',
              coachingNote: 'The customer should hear both the minimum rule and the exact remaining amount after deposit.',
              isBest: true,
            },
            {
              id: 'change-hours',
              label: 'Quietly bill fewer hours to avoid the conversation.',
              outcome: 'That creates inconsistency and breaks the pricing system.',
              coachingNote: 'Do not solve weak explanation by corrupting the billing logic.',
            },
          ],
        },
      },
      {
        id: 'payment-controls',
        type: 'card',
        title: 'Deposit, balance, invoice',
        summary: 'Reps should know which move to use instead of freezing when a customer wants another payment path.',
        points: [
          'Deposit collects commitment and locks in the date and sold pricing.',
          'Charge balance is for card-on-file collection when the customer is ready and authorized.',
          'Manual invoice is for customers who want an email invoice or separate balance request.',
          'If the job actuals change, the quote must reflect the correct billing model before the balance request is sent.',
        ],
      },
      {
        id: 'billing-video-slot',
        type: 'video',
        title: 'Billing walkthrough slot',
        summary: 'Use this slot for a short owner walkthrough of deposits, balance charging, and when to send a manual invoice.',
        points: [
          'Show one fast-lane example.',
          'Show one standard binding example.',
          'Show one manual invoice example from the lead page.',
        ],
        videoUrl: null,
        videoPlaceholder: 'Add a 5-minute billing walkthrough here.',
      },
    ],
  },
  {
    id: 'tonality-lab',
    title: 'Tonality Lab',
    badge: 'Required',
    description: 'This course trains how the rep should sound: confident, audible, warm, and in control without sounding robotic or flat.',
    objective: 'Reps should learn to set tone, hold calm authority, and hear the difference between strong delivery and dead delivery.',
    estimatedMinutes: 20,
    required: true,
    version: '2026.05.4',
    updatedAt: '2026-05-01',
    audience: ['Sales Rep', 'Manager', 'Owner'],
    resources: [
      { label: 'Open Read First', href: '/sales/read-first' },
      { label: 'Open Academy Home', href: '/sales/academy' },
    ],
    lessons: [
      {
        id: 'tonality-matters-card',
        type: 'card',
        title: 'Tone builds trust before pricing ever does',
        summary: 'Customers decide how seriously to take the rep before the estimate is even discussed.',
        points: [
          'A flat or sleepy delivery makes the company sound weak, even if the words are technically correct.',
          'A rushed or pushy delivery makes the customer guard up, even if the structure is right.',
          'The goal is not to copy John exactly. The goal is to sound alive, clear, and calm in your own voice.',
          'Good tonality makes the customer feel they are talking to a professional mover, not someone guessing their way through a call.',
        ],
      },
      {
        id: 'tone-contrast-card',
        type: 'card',
        title: 'What strong tone sounds like',
        summary: 'Use contrast to train the ear before you train the mouth.',
        points: [
          'Weak tone: monotone, low energy, uncertain endings, trailing off, or sounding half-asleep.',
          'Strong tone: open mouth, clean volume, slight lift in the greeting, calm pace, and confident transitions.',
          'Guided control should sound inviting, not combative.',
          'Empathy should sound sincere, not scripted.',
        ],
      },
      {
        id: 'tonality-practice',
        type: 'practice',
        title: 'Practice lab: record yourself',
        summary: 'Use the browser recorder to practice the exact lines reps need on live calls.',
        practice: {
          intro: 'Record each line, play it back, and listen for smile in the voice, pacing, audible confidence, and whether you still sound human.',
          checklist: [
            'Can the customer hear energy in your first line without you sounding fake?',
            'Do your sentences land cleanly, or do they fade out at the end?',
            'Do you sound like you are guiding the customer, not reading at them?',
            'When you show empathy, does it sound warm and believable?',
            'Would you trust this voice with your own move?',
          ],
          prompts: [
            {
              id: 'tone-opener',
              title: 'Opener',
              targetLine: 'Saturn Star Movers, John speaking. How can I help you today?',
              strongExample: 'Warm, awake, and inviting. The customer should feel welcomed in the first sentence.',
              weakExample: 'Flat, quiet, and rushed. It sounds like the rep wants the call to end before it starts.',
              coachingFocus: ['Energy', 'Warmth', 'Clarity'],
            },
            {
              id: 'tone-guided-control',
              title: 'Guided control',
              targetLine: 'Perfect, I can help with that. Let me ask you a few quick questions so I can give you an accurate quote.',
              strongExample: 'Confident and calming. It sounds like you know exactly how the process works.',
              weakExample: 'Bossy, clipped, or defensive. It sounds like you are trying to overpower the customer.',
              coachingFocus: ['Control', 'Calm pace', 'Professional authority'],
            },
            {
              id: 'tone-empathy',
              title: 'Empathy line',
              targetLine: 'I am really sorry you are dealing with that. We will make this part easier for you.',
              strongExample: 'Softens slightly without losing clarity. The customer should feel understood, not pitied.',
              weakExample: 'Overacted, rushed, or emotionless. It feels fake or detached.',
              coachingFocus: ['Sincerity', 'Pacing', 'Reassurance'],
            },
          ],
          outro: 'Managers can use these exact prompts in onboarding before live calls. The rep does not need your exact voice. They need a strong version of their own.',
        },
      },
      {
        id: 'tonality-video-slot',
        type: 'video',
        title: 'Audio and Loom examples slot',
        summary: 'Use this lesson for future strong-vs-weak tone examples, opener walk-throughs, and vocal warm-up demos.',
        points: [
          'Record one strong opener, one flat opener, and one rushed opener so reps can hear the difference.',
          'Add one empathy example and one guided-control example to make the contrast obvious.',
          'Keep clips short so reps actually replay them before a shift.',
        ],
        videoUrl: null,
        videoPlaceholder: 'Add Loom, YouTube, or training audio examples here in a future update.',
      },
    ],
  },
  {
    id: 'phrase-bank',
    title: 'Phrase Bank',
    badge: 'Required',
    description: 'This is the approved language bank reps can lean on while they build their own footing.',
    objective: 'Reps should have strong default lines for openers, guided control, empathy, urgency, and tentative reservation.',
    estimatedMinutes: 24,
    required: true,
    version: '2026.05.4',
    updatedAt: '2026-05-01',
    audience: ['Sales Rep', 'Manager'],
    resources: [
      { label: 'Open Read First', href: '/sales/read-first' },
      { label: 'Open Leads Workspace', href: '/sales/leads' },
    ],
    lessons: [
      {
        id: 'phrase-openers',
        type: 'flashcards',
        title: 'Openers and guided-control phrases',
        summary: 'Use language like this until your own delivery becomes natural.',
        flashcards: [
          { id: 'pb-opener-1', tag: 'Tone', front: 'Approved opener', back: 'Saturn Star Movers, John speaking. How can I help you today?' },
          { id: 'pb-guided-1', tag: 'Control', front: 'Approved control line', back: 'Perfect, I can help with that. Let me ask you a few quick questions so I can give you an accurate quote.' },
          { id: 'pb-confirm-1', tag: 'Assess', front: 'Approved confirmation line', back: 'Thank you for giving me that. Let me just confirm a few details so I quote this properly.' },
          { id: 'pb-hold-1', tag: 'Flow', front: 'Approved hold line', back: 'Give me two quick seconds while I pull that up so I can be accurate.' },
        ],
      },
      {
        id: 'phrase-empathy',
        type: 'card',
        title: 'Empathy and human moments',
        summary: 'Reps should know how to sound human when life context comes up on the call.',
        points: [
          'Loss or stress: "I am really sorry you are dealing with that. We will make this part easier for you."',
          'Upsizing or a new baby: "That is exciting. Congratulations. Let us help make the move side smooth for you."',
          'New job or relocation: "Congratulations on the move. Let me make sure this quote is dialed in so the transition feels easier."',
          'Beautiful home or new construction: "It looks like a really nice place. Let me make sure we price this properly for the route and inventory."',
        ],
      },
      {
        id: 'phrase-closing',
        type: 'flashcards',
        title: 'Tentative reservation, urgency, and close language',
        summary: 'These lines help reps move from quote delivery into commitment.',
        flashcards: [
          { id: 'pb-close-1', tag: 'Tentative', front: 'Tentative reservation line', back: 'What I can do is tentatively hold that slot while you look this over, then I will follow up with you before it opens back up.' },
          { id: 'pb-close-2', tag: 'Assumptive', front: 'Assumptive close line', back: 'Based on everything you told me, this is the lane I would recommend. Let us get the quote over so we can lock the next step in.' },
          { id: 'pb-close-3', tag: 'Urgency', front: 'Clean urgency line', back: 'This estimate is valid for 7 days, and if you want I can note the slot now so you are not starting from scratch later.' },
          { id: 'pb-close-4', tag: 'Policy', front: 'Minimum-hours clarity line', back: 'Important: this lane carries a three-hour minimum, so even if the crew finishes earlier, that minimum still applies.' },
        ],
      },
      {
        id: 'phrase-small-talk-scenario',
        type: 'scenario',
        title: 'Scenario: blend small talk without losing structure',
        summary: 'Be human, then steer the call back where it needs to go.',
        scenario: {
          customerLine: 'We are only moving because I got a new job out there, so everything has been a little crazy.',
          setup: 'There is a real human moment, but the rep still needs to keep the estimate moving.',
          prompt: 'What is the strongest rep move?',
          options: [
            {
              id: 'ignore-life-context',
              label: 'Ignore the comment and jump straight into the next inventory question.',
              outcome: 'You keep structure, but you miss a trust moment.',
              coachingNote: 'Good reps do not waste easy rapport.',
            },
            {
              id: 'full-detour',
              label: 'Turn the conversation fully into personal small talk and lose the estimate flow.',
              outcome: 'That sounds friendly, but it drains control.',
              coachingNote: 'Rapport is useful only if the structure survives it.',
            },
            {
              id: 'human-then-steer',
              label: 'Acknowledge the life moment warmly, then steer right back into the next estimate step.',
              outcome: 'Correct. You sound human without dropping the sales process.',
              coachingNote: 'Best language sounds like: "That is exciting, congrats. Let me make sure we get this quote right for you. What does the destination access look like?"',
              isBest: true,
            },
          ],
        },
      },
    ],
  },
  {
    id: 'crm-rhythm',
    title: 'CRM Rhythm',
    badge: 'Required',
    description: 'This module teaches the rep what Mission Control expects inside the software every day, not just what to say on the phone.',
    objective: 'Reps should know where to work, what to update, and how leads move from inbound to booked to customer success.',
    estimatedMinutes: 16,
    required: true,
    version: '2026.05',
    updatedAt: '2026-05-01',
    audience: ['Sales Rep', 'Manager'],
    resources: [
      { label: 'Open Inbox', href: '/sales/inbox' },
      { label: 'Open Pipeline', href: '/sales/pipeline' },
      { label: 'Open Activity Feed', href: '/sales/activity' },
    ],
    lessons: [
      {
        id: 'daily-rhythm',
        type: 'card',
        title: 'Daily rhythm inside Mission Control',
        summary: 'The rep workflow should be repeatable every day.',
        points: [
          'Start with Inbox and urgent follow-ups, not random browsing.',
          'Move qualified leads through stages immediately instead of leaving the pipeline stale.',
          'Every call, quote revision, and next step should leave a clear trail in the timeline.',
          'Booked work does not disappear - it becomes an ops handoff, then a completed move, then customer success.',
        ],
      },
      {
        id: 'stage-map',
        type: 'card',
        title: 'Stage map',
        summary: 'Stages are not decoration. They tell the next human what reality is.',
        points: [
          'Use tentative when the date is being held but the customer has not fully committed yet.',
          'Use booked when the job is confirmed and ready for dispatch workflow.',
          'Use completed when the move is done and outcome is logged.',
          'Use customer success after the review request and post-move follow-through are done.',
        ],
      },
      {
        id: 'followup-scenario',
        type: 'scenario',
        title: 'Scenario: quote sent, no reply for 24 hours',
        summary: 'Follow-up is part of the sale, not an afterthought.',
        scenario: {
          customerLine: 'No reply yet - the customer has gone quiet after receiving the quote.',
          setup: 'The lead is warm, the quote was sent, and the rep needs the next move.',
          prompt: 'What is the best action?',
          options: [
            {
              id: 'wait-longer',
              label: 'Wait a few more days so you do not seem pushy.',
              outcome: 'That is how active leads become nurture by accident.',
              coachingNote: 'Silence after a quote is exactly when disciplined follow-up matters.',
            },
            {
              id: 'close-attempt',
              label: 'Send a direct follow-up tied to the quote and move date, with a clear next step or hold offer.',
              outcome: 'Correct. That is a close attempt, not a vague check-in.',
              coachingNote: 'Tie the follow-up to timing, availability, or decision support.',
              isBest: true,
            },
            {
              id: 'new-quote',
              label: 'Build a new quote from scratch and resend it with no context.',
              outcome: 'That wastes time and can confuse the lead.',
              coachingNote: 'Follow up on the active quote unless the scope changed.',
            },
          ],
        },
      },
      {
        id: 'ops-handoff',
        type: 'card',
        title: 'From sale to operations',
        summary: 'Once the job is sold, the system should make handoff cleaner, not noisier.',
        points: [
          'Confirm that the sold truck count and route details are accurate before confirming the job.',
          'Use notes for anything the crew or ops lead must know on move day.',
          'Treat booked jobs as an ops handoff, not as dead sales records.',
          'A sloppy handoff creates downstream arguments that look like sales problems later.',
        ],
      },
    ],
  },
  {
    id: 'call-review-lab',
    title: 'Call Review Lab',
    badge: 'Recommended',
    description: 'This is the coaching loop. It teaches reps and managers how to review calls using standards instead of vague feedback.',
    objective: 'Managers should be able to coach one call at a time, and reps should know exactly what was missed.',
    estimatedMinutes: 17,
    required: false,
    version: '2026.05',
    updatedAt: '2026-05-01',
    audience: ['Manager', 'Owner', 'Sales Rep'],
    resources: [
      { label: 'Open Leads Workspace', href: '/sales/leads' },
      { label: 'Open Dialer Health', href: '/sales/dialer-health' },
    ],
    lessons: [
      {
        id: 'pace-review-lens',
        type: 'acronym',
        title: 'P.A.C.E.',
        summary: 'A simple review lens for call coaching.',
        steps: [
          {
            letter: 'P',
            title: 'Presence',
            summary: 'Did the rep sound alive, clear, and professional?',
          },
          {
            letter: 'A',
            title: 'Assessment',
            summary: 'Did the rep uncover route, inventory, access, concerns, and upsells?',
          },
          {
            letter: 'C',
            title: 'Control',
            summary: 'Did the rep lead the conversation or get dragged around by the customer?',
          },
          {
            letter: 'E',
            title: 'Exact next step',
            summary: 'Did the call end with a real commitment, follow-up point, or reservation path?',
          },
        ],
      },
      {
        id: 'review-flashcards',
        type: 'flashcards',
        title: 'Review checklist flashcards',
        summary: 'Use these to make coaching sessions consistent.',
        flashcards: [
          { id: 'fc-info-first', tag: 'Checklist', front: 'Was contact info captured before estimate delivery?', back: 'If not, that is a process failure even if the call sounded good.' },
          { id: 'fc-upsells-review', tag: 'Checklist', front: 'Did the rep ask packing, junk, and specialty questions?', back: 'All three should be visible in strong calls.' },
          { id: 'fc-close-review', tag: 'Checklist', front: 'Did the rep roll into the reservation?', back: 'A strong call ends with a commitment move, not a yes-or-no trap.' },
          { id: 'fc-tentative-review', tag: 'Checklist', front: 'If the lead did not book, was a tentative reservation offered?', back: 'That is one of the most important coaching checks in this system.' },
        ],
      },
      {
        id: 'manager-review-scenario',
        type: 'scenario',
        title: 'Scenario: average call review',
        summary: 'Coach one thing, not ten things.',
        scenario: {
          customerLine: 'The rep sounded friendly and quoted the move, but never captured email and ended with "let me know what you think."',
          setup: 'The call was not terrible, but it missed core process.',
          prompt: 'What is the strongest coaching move?',
          options: [
            {
              id: 'praise-only',
              label: 'Tell the rep it was fine because the customer seemed happy.',
              outcome: 'That preserves bad habits.',
              coachingNote: 'Being nice on calls is not enough.',
            },
            {
              id: 'fix-one-core-gap',
              label: 'Coach the missing contact capture and weak close, then roleplay the corrected version immediately.',
              outcome: 'Correct. You focused on the biggest process leak and converted it into practice.',
              coachingNote: 'The best coaching is specific and repeated, not vague and overwhelming.',
              isBest: true,
            },
            {
              id: 'criticize-everything',
              label: 'List ten problems at once so the rep understands the standard.',
              outcome: 'That usually creates noise instead of improvement.',
              coachingNote: 'Fix one critical behavior at a time.',
            },
          ],
        },
      },
      {
        id: 'review-video-slot',
        type: 'video',
        title: 'Call review session slot',
        summary: 'Use this slot for a manager-led call review where a real recording is paused and corrected live.',
        points: [
          'Choose one good call, one average call, and one weak call.',
          'Pause only at moments that teach control, assessment, or close quality.',
          'Tie corrections back to the academy modules so the system stays connected.',
        ],
        videoUrl: null,
        videoPlaceholder: 'Add a real call review walkthrough here.',
      },
    ],
  },
]

export function getSalesAcademyModule(moduleId: string) {
  return SALES_ACADEMY_MODULES.find(module => module.id === moduleId) || null
}
