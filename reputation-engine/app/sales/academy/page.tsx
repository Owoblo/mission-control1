'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type {
  AcademyFlashcard,
  AcademyLesson,
  AcademyModule,
  AcademyModuleSection,
  AcademyPracticePrompt,
  AcademyReleaseNote,
} from '@/lib/sales-academy'

interface AcademyProgressRecord {
  id?: string
  moduleId: string
  completedLessons: string[]
  scenarioAnswers: Record<string, string>
  acknowledgedVersion: string | null
  lastOpenedAt: string | null
  completedAt: string | null
}

interface AcademyPayload {
  user: {
    id: string
    name: string
    role: string
  }
  modules: AcademyModule[]
  releases: AcademyReleaseNote[]
  progress: Record<string, AcademyProgressRecord>
  storageAvailable: boolean
}

const LESSON_TYPE_LABELS: Record<AcademyLesson['type'], string> = {
  card: 'Card',
  acronym: 'Framework',
  scenario: 'Scenario',
  flashcards: 'Flashcards',
  video: 'Video',
  practice: 'Practice',
}

const MODULE_VISUALS: Record<string, {
  icon: string
  eyebrow: string
  solidBg: string
  accentClass: string
}> = {
  'star-framework': {
    icon: '✦',
    eyebrow: 'Call system',
    solidBg: 'bg-amber-50',
    accentClass: 'text-amber-700',
  },
  'estimate-builder': {
    icon: '▣',
    eyebrow: 'Quoting',
    solidBg: 'bg-emerald-50',
    accentClass: 'text-emerald-700',
  },
  'closing-playbook': {
    icon: '↗',
    eyebrow: 'Closing',
    solidBg: 'bg-orange-50',
    accentClass: 'text-orange-700',
  },
  'fast-lane-billing': {
    icon: '⚡',
    eyebrow: 'Billing',
    solidBg: 'bg-yellow-50',
    accentClass: 'text-amber-800',
  },
  'tonality-lab': {
    icon: '◉',
    eyebrow: 'Voice lab',
    solidBg: 'bg-indigo-50',
    accentClass: 'text-indigo-700',
  },
  'phrase-bank': {
    icon: '❝',
    eyebrow: 'Language',
    solidBg: 'bg-violet-50',
    accentClass: 'text-violet-700',
  },
  'crm-rhythm': {
    icon: '⌘',
    eyebrow: 'Workflow',
    solidBg: 'bg-sky-50',
    accentClass: 'text-sky-700',
  },
  'call-review-lab': {
    icon: '◌',
    eyebrow: 'Coaching',
    solidBg: 'bg-teal-50',
    accentClass: 'text-teal-700',
  },
}

function getModuleVisual(moduleId: string) {
  return MODULE_VISUALS[moduleId] || {
    icon: '◼',
    eyebrow: 'Course',
    solidBg: 'bg-slate-50',
    accentClass: 'text-slate-700',
  }
}

function formatRelativeDate(value?: string | null) {
  if (!value) return 'Not opened yet'
  const diff = Date.now() - new Date(value).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function buildLocalStorageKey(userId: string) {
  return `sales-academy-progress:${userId}`
}

function getDefaultProgress(moduleId: string): AcademyProgressRecord {
  return {
    moduleId,
    completedLessons: [],
    scenarioAnswers: {},
    acknowledgedVersion: null,
    lastOpenedAt: null,
    completedAt: null,
  }
}

function readLocalProgress(userId: string) {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(buildLocalStorageKey(userId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, AcademyProgressRecord>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveLocalProgress(userId: string, progress: Record<string, AcademyProgressRecord>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(buildLocalStorageKey(userId), JSON.stringify(progress))
  } catch {
    // ignore local storage failures
  }
}

function mergeProgress(
  serverProgress: Record<string, AcademyProgressRecord>,
  localProgress: Record<string, AcademyProgressRecord>
) {
  const merged: Record<string, AcademyProgressRecord> = { ...serverProgress }
  for (const [moduleId, localRecord] of Object.entries(localProgress)) {
    const current = merged[moduleId] || getDefaultProgress(moduleId)
    merged[moduleId] = {
      ...current,
      ...localRecord,
      completedLessons: Array.from(new Set([...(current.completedLessons || []), ...(localRecord.completedLessons || [])])),
      scenarioAnswers: {
        ...(current.scenarioAnswers || {}),
        ...(localRecord.scenarioAnswers || {}),
      },
      acknowledgedVersion: localRecord.acknowledgedVersion || current.acknowledgedVersion || null,
      lastOpenedAt: localRecord.lastOpenedAt || current.lastOpenedAt || null,
      completedAt: localRecord.completedAt || current.completedAt || null,
    }
  }
  return merged
}

function getModuleCompletionPercent(module: AcademyModule, progress: AcademyProgressRecord | undefined) {
  const totalLessons = module.lessons.length
  if (!totalLessons) return 0
  const completed = module.lessons.filter(lesson => progress?.completedLessons?.includes(lesson.id)).length
  return Math.round((completed / totalLessons) * 100)
}

function getOverallCompletion(modules: AcademyModule[], progress: Record<string, AcademyProgressRecord>) {
  const requiredModules = modules.filter(module => module.required)
  const totalLessons = requiredModules.reduce((sum, module) => sum + module.lessons.length, 0)
  const completedLessons = requiredModules.reduce((sum, module) => {
    const row = progress[module.id]
    return sum + module.lessons.filter(lesson => row?.completedLessons?.includes(lesson.id)).length
  }, 0)
  return totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0
}

function getScenarioChoice(lesson: AcademyLesson, progress: AcademyProgressRecord | undefined) {
  const selectedId = progress?.scenarioAnswers?.[lesson.id]
  if (!selectedId || !lesson.scenario) return null
  return lesson.scenario.options.find(option => option.id === selectedId) || null
}

function getPreferredLessonId(module: AcademyModule, progress: AcademyProgressRecord | undefined) {
  const firstOpen = module.lessons.find(lesson => !progress?.completedLessons?.includes(lesson.id))
  return firstOpen?.id || module.lessons[0]?.id || ''
}

function getModuleSections(module: AcademyModule): AcademyModuleSection[] {
  if (module.sections?.length) return module.sections
  return [
    {
      id: `${module.id}-all`,
      title: 'All lessons',
      shortTitle: 'All',
      summary: module.description,
    },
  ]
}

function getLessonSectionId(module: AcademyModule, lessonId: string) {
  const lesson = module.lessons.find(item => item.id === lessonId)
  return lesson?.sectionId || getModuleSections(module)[0]?.id || ''
}

function getSectionLessons(module: AcademyModule, sectionId: string) {
  if (!module.sections?.length) return module.lessons
  return module.lessons.filter(lesson => (lesson.sectionId || module.sections?.[0]?.id) === sectionId)
}

function getPreferredLessonIdForSection(
  module: AcademyModule,
  progress: AcademyProgressRecord | undefined,
  sectionId: string
) {
  const lessons = getSectionLessons(module, sectionId)
  const firstOpen = lessons.find(lesson => !progress?.completedLessons?.includes(lesson.id))
  return firstOpen?.id || lessons[0]?.id || getPreferredLessonId(module, progress)
}

function getSectionCompletionPercent(
  module: AcademyModule,
  progress: AcademyProgressRecord | undefined,
  sectionId: string
) {
  const lessons = getSectionLessons(module, sectionId)
  if (!lessons.length) return 0
  const completed = lessons.filter(lesson => progress?.completedLessons?.includes(lesson.id)).length
  return Math.round((completed / lessons.length) * 100)
}

function getNextLessonId(module: AcademyModule, lessonId: string) {
  const index = module.lessons.findIndex(lesson => lesson.id === lessonId)
  if (index < 0) return ''
  return module.lessons[index + 1]?.id || ''
}

function getPreviousLessonId(module: AcademyModule, lessonId: string) {
  const index = module.lessons.findIndex(lesson => lesson.id === lessonId)
  if (index <= 0) return ''
  return module.lessons[index - 1]?.id || ''
}

function ModuleIllustration({
  module,
  compact = false,
}: {
  module: AcademyModule
  compact?: boolean
}) {
  const visual = getModuleVisual(module.id)
  return (
    <div className={`relative overflow-hidden rounded-[22px] border border-[var(--app-line)] ${visual.solidBg} ${compact ? 'h-24' : 'h-32'}`}>
      <div className="relative flex h-full items-end justify-between p-4">
        <div className="min-w-0">
          <div className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${visual.accentClass}`}>{visual.eyebrow}</div>
          <div className="mt-2 max-w-[180px] text-sm font-semibold leading-5 text-[var(--app-ink)]">
            {module.title}
          </div>
        </div>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-white/85 text-2xl text-[var(--app-ink)] shadow-sm">
          {visual.icon}
        </div>
      </div>
    </div>
  )
}

function FlashcardGrid({
  flashcards,
  revealedCards,
  onToggle,
}: {
  flashcards: AcademyFlashcard[]
  revealedCards: Record<string, boolean>
  onToggle: (flashcardId: string) => void
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {flashcards.map(card => {
        const revealed = !!revealedCards[card.id]
        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onToggle(card.id)}
            className="rounded-[14px] border border-[var(--app-line)] bg-[var(--app-panel)] p-4 text-left transition hover:border-[var(--app-ink)] hover:bg-[var(--app-bg)]"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="rounded-full bg-[var(--app-wash)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                {card.tag || 'Card'}
              </span>
              <span className="text-xs font-medium text-[var(--app-muted)]">{revealed ? 'Hide answer' : 'Reveal answer'}</span>
            </div>
            <div className="text-sm font-semibold text-[var(--app-ink)]">{card.front}</div>
            <div className={`mt-3 text-sm leading-6 ${revealed ? 'text-[var(--app-ink)]' : 'text-[var(--app-muted)]'}`}>
              {revealed ? card.back : 'Tap to reveal the approved answer.'}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function PracticePromptCard({
  prompt,
  recordingUrl,
  recording,
  onStart,
  onStop,
}: {
  prompt: AcademyPracticePrompt
  recordingUrl?: string
  recording: boolean
  onStart: (promptId: string) => void
  onStop: () => void
}) {
  return (
    <div className="rounded-[18px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Practice prompt</div>
          <div className="mt-1 text-lg font-semibold text-[var(--app-ink)]">{prompt.title}</div>
        </div>
        <button
          type="button"
          onClick={() => (recording ? onStop() : onStart(prompt.id))}
          className={recording ? 'crm-button-dark' : 'crm-button'}
        >
          {recording ? 'Stop recording' : 'Record yourself'}
        </button>
      </div>

      <div className="mt-4 rounded-[14px] border border-[var(--app-line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--app-ink)]">
        "{prompt.targetLine}"
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {prompt.strongExample ? (
          <div className="rounded-[14px] bg-emerald-50 p-4 text-sm leading-6 text-emerald-800">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">Strong delivery</div>
            <div className="mt-2">{prompt.strongExample}</div>
          </div>
        ) : null}
        {prompt.weakExample ? (
          <div className="rounded-[14px] bg-amber-50 p-4 text-sm leading-6 text-amber-800">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700">Weak delivery</div>
            <div className="mt-2">{prompt.weakExample}</div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {prompt.coachingFocus.map(item => (
          <span key={item} className="rounded-full bg-[var(--app-wash)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
            {item}
          </span>
        ))}
      </div>

      {recordingUrl ? (
        <div className="mt-4 rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Playback</div>
          <audio controls className="mt-3 w-full" src={recordingUrl} />
        </div>
      ) : null}
    </div>
  )
}

function CoursePathRow({
  module,
  percent,
  needsReview,
  actionLabel,
  order,
  highlight,
  onOpen,
}: {
  module: AcademyModule
  percent: number
  needsReview: boolean
  actionLabel: string
  order: number
  highlight?: string
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full rounded-[24px] border border-[var(--app-line)] bg-[var(--app-panel)] p-4 text-left transition hover:border-[var(--app-ink)] hover:shadow-sm"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--app-ink)] text-sm font-semibold text-white">
            {order}
          </div>
          <div className="w-[138px] shrink-0">
            <ModuleIllustration module={module} compact />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">{module.badge}</span>
              {highlight ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                  {highlight}
                </span>
              ) : null}
              {needsReview ? (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                  Review update
                </span>
              ) : null}
            </div>
            <div className="mt-2 text-[18px] font-semibold leading-6 text-[var(--app-ink)]">{module.title}</div>
            <div className="mt-1 max-w-2xl text-sm leading-6 text-[var(--app-muted)]">
              {module.description}
            </div>
          </div>
        </div>
        <div className="xl:w-[260px] xl:shrink-0">
          <div className="flex items-center justify-between text-[11px] text-[var(--app-muted)]">
            <span>{module.lessons.length} lessons</span>
            <span>{module.estimatedMinutes} min</span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-[var(--app-wash)]">
            <div className="h-1.5 rounded-full bg-[var(--app-accent)] transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--app-muted)]">{percent}% complete</span>
            <span className="text-sm font-semibold text-[var(--app-ink)]">{actionLabel} →</span>
          </div>
        </div>
      </div>
    </button>
  )
}

function LabShelfCard({
  module,
  percent,
  needsReview,
  actionLabel,
  onOpen,
}: {
  module: AcademyModule
  percent: number
  needsReview: boolean
  actionLabel: string
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group rounded-[22px] border border-[var(--app-line)] bg-[var(--app-panel)] p-4 text-left transition hover:border-[var(--app-ink)] hover:shadow-sm"
    >
      <div className="flex items-start gap-4">
        <div className="w-[112px] shrink-0">
          <ModuleIllustration module={module} compact />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">{module.badge}</span>
            {needsReview ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                Review
              </span>
            ) : null}
          </div>
          <div className="mt-2 text-[16px] font-semibold leading-5 text-[var(--app-ink)]">{module.title}</div>
          <div className="mt-2 text-sm leading-6 text-[var(--app-muted)]">{module.description}</div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--app-muted)]">
            <span>{module.lessons.length} lessons</span>
            <span>{module.estimatedMinutes} min</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-[var(--app-wash)]">
            <div className="h-1.5 rounded-full bg-[var(--app-accent)] transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--app-muted)]">{percent}% complete</span>
            <span className="text-sm font-semibold text-[var(--app-ink)]">{actionLabel} →</span>
          </div>
        </div>
      </div>
    </button>
  )
}

export default function SalesAcademyPage() {
  const [payload, setPayload] = useState<AcademyPayload | null>(null)
  const [progress, setProgress] = useState<Record<string, AcademyProgressRecord>>({})
  const [activeModuleId, setActiveModuleId] = useState('')
  const [activeSectionId, setActiveSectionId] = useState('')
  const [activeLessonId, setActiveLessonId] = useState('')
  const [academyView, setAcademyView] = useState<'library' | 'classroom'>('library')
  const [revealedCards, setRevealedCards] = useState<Record<string, boolean>>({})
  const [practiceRecordings, setPracticeRecordings] = useState<Record<string, string>>({})
  const [recordingPromptId, setRecordingPromptId] = useState('')
  const [practiceError, setPracticeError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'synced' | 'local'>('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recorderPromptRef = useRef('')
  const recorderStreamRef = useRef<MediaStream | null>(null)
  const recorderChunksRef = useRef<Blob[]>([])
  const recordingsRef = useRef<Record<string, string>>({})

  useEffect(() => {
    recordingsRef.current = practiceRecordings
  }, [practiceRecordings])

  useEffect(() => {
    return () => {
      recorderStreamRef.current?.getTracks().forEach(track => track.stop())
      Object.values(recordingsRef.current).forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadAcademy() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch('/api/sales/academy', { credentials: 'include', cache: 'no-store' })
        if (!response.ok) {
          throw new Error(response.status === 401 ? 'Unauthorized' : 'Could not load academy')
        }
        const data = await response.json() as AcademyPayload
        if (cancelled) return
        const localProgress = readLocalProgress(data.user.id)
        const mergedProgress = mergeProgress(data.progress || {}, localProgress)
        setPayload(data)
        setProgress(mergedProgress)
        setActiveModuleId(current => current || data.modules[0]?.id || '')
        setSaveState(data.storageAvailable ? 'synced' : 'local')
        setSaveMessage(data.storageAvailable ? '' : 'Cloud progress is not enabled yet. Progress will still stay in this browser.')
        saveLocalProgress(data.user.id, mergedProgress)
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Could not load academy')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadAcademy()
    return () => {
      cancelled = true
    }
  }, [])

  const modules = payload?.modules || []
  const releases = payload?.releases || []
  const activeModule = modules.find(module => module.id === activeModuleId) || modules[0] || null
  const activeProgress = activeModule ? (progress[activeModule.id] || getDefaultProgress(activeModule.id)) : null
  const activeLesson = activeModule?.lessons.find(lesson => lesson.id === activeLessonId) || activeModule?.lessons[0] || null
  const activeSections = activeModule ? getModuleSections(activeModule) : []
  const activeSection = activeSections.find(section => section.id === activeSectionId) || activeSections[0] || null
  const activeSectionLessons = activeModule && activeSection ? getSectionLessons(activeModule, activeSection.id) : []

  useEffect(() => {
    if (!activeModule) return
    const lessonIds = new Set(activeModule.lessons.map(lesson => lesson.id))
    if (!activeLessonId || !lessonIds.has(activeLessonId)) {
      setActiveLessonId(getPreferredLessonId(activeModule, activeProgress || undefined))
    }
  }, [activeLessonId, activeModule, activeProgress])

  useEffect(() => {
    if (!activeModule) return
    const sectionIds = new Set(getModuleSections(activeModule).map(section => section.id))
    const derivedSectionId = activeLesson ? getLessonSectionId(activeModule, activeLesson.id) : getModuleSections(activeModule)[0]?.id || ''
    if (!activeSectionId || !sectionIds.has(activeSectionId) || activeSectionId !== derivedSectionId) {
      setActiveSectionId(derivedSectionId)
    }
  }, [activeLesson, activeModule, activeSectionId])

  async function syncModuleProgress(moduleId: string, nextRecord: AcademyProgressRecord) {
    setSaveState('saving')
    setSaveMessage('Saving academy progress...')

    try {
      const response = await fetch('/api/sales/academy/progress', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextRecord),
      })
      if (!response.ok) {
        throw new Error('Progress sync unavailable')
      }
      const data = await response.json() as { record?: AcademyProgressRecord }
      setProgress(current => ({
        ...current,
        [moduleId]: data.record || nextRecord,
      }))
      setSaveState('synced')
      setSaveMessage('Progress synced.')
    } catch {
      setSaveState('local')
      setSaveMessage('Progress saved in this browser. Cloud sync can be enabled later.')
    }
  }

  function updateModuleProgress(module: AcademyModule, updater: (current: AcademyProgressRecord) => AcademyProgressRecord) {
    const current = progress[module.id] || getDefaultProgress(module.id)
    const next = updater(current)
    const normalizedNext = {
      ...next,
      moduleId: module.id,
      completedLessons: Array.from(new Set(next.completedLessons)),
    }
    const nextProgress = {
      ...progress,
      [module.id]: normalizedNext,
    }
    setProgress(prev => ({
      ...prev,
      [module.id]: normalizedNext,
    }))
    if (payload?.user?.id) {
      saveLocalProgress(payload.user.id, nextProgress)
    }
    void syncModuleProgress(module.id, normalizedNext)
  }

  function markLesson(module: AcademyModule, lessonId: string, completed: boolean) {
    updateModuleProgress(module, current => {
      const nextCompleted = completed
        ? Array.from(new Set([...current.completedLessons, lessonId]))
        : current.completedLessons.filter(item => item !== lessonId)
      const finished = module.lessons.every(lesson => nextCompleted.includes(lesson.id))
      return {
        ...current,
        completedLessons: nextCompleted,
        completedAt: finished ? current.completedAt || new Date().toISOString() : null,
      }
    })
  }

  function recordScenario(module: AcademyModule, lesson: AcademyLesson, answerId: string) {
    updateModuleProgress(module, current => {
      const nextCompleted = Array.from(new Set([...current.completedLessons, lesson.id]))
      const finished = module.lessons.every(item => nextCompleted.includes(item.id))
      return {
        ...current,
        completedLessons: nextCompleted,
        scenarioAnswers: {
          ...current.scenarioAnswers,
          [lesson.id]: answerId,
        },
        completedAt: finished ? current.completedAt || new Date().toISOString() : null,
      }
    })
  }

  function acknowledgeModule(module: AcademyModule) {
    updateModuleProgress(module, current => ({
      ...current,
      acknowledgedVersion: module.version,
      lastOpenedAt: new Date().toISOString(),
    }))
  }

  function openModule(moduleId: string, view: 'library' | 'classroom' = 'classroom') {
    stopPracticeRecording()
    const module = modules.find(item => item.id === moduleId)
    if (!module) return
    const preferredLessonId = getPreferredLessonId(module, progress[moduleId])
    setActiveModuleId(moduleId)
    setActiveLessonId(preferredLessonId)
    setActiveSectionId(getLessonSectionId(module, preferredLessonId))
    setAcademyView(view)
    updateModuleProgress(module, current => ({
      ...current,
      lastOpenedAt: new Date().toISOString(),
    }))
  }

  function openLesson(module: AcademyModule, lessonId: string) {
    stopPracticeRecording()
    setActiveModuleId(module.id)
    setActiveLessonId(lessonId)
    setActiveSectionId(getLessonSectionId(module, lessonId))
    setAcademyView('classroom')
    updateModuleProgress(module, current => ({
      ...current,
      lastOpenedAt: new Date().toISOString(),
    }))
  }

  function openSection(module: AcademyModule, sectionId: string) {
    stopPracticeRecording()
    setActiveModuleId(module.id)
    setActiveSectionId(sectionId)
    setActiveLessonId(getPreferredLessonIdForSection(module, progress[module.id], sectionId))
    setAcademyView('classroom')
    updateModuleProgress(module, current => ({
      ...current,
      lastOpenedAt: new Date().toISOString(),
    }))
  }

  function markLessonAndMaybeAdvance(module: AcademyModule, lessonId: string) {
    const alreadyCompleted = (progress[module.id] || getDefaultProgress(module.id)).completedLessons.includes(lessonId)
    if (!alreadyCompleted) {
      markLesson(module, lessonId, true)
    }
    const nextLessonId = getNextLessonId(module, lessonId)
    if (nextLessonId) {
      setActiveLessonId(nextLessonId)
    }
  }

  function toggleFlashcard(flashcardId: string) {
    setRevealedCards(current => ({
      ...current,
      [flashcardId]: !current[flashcardId],
    }))
  }

  function stopPracticeRecording() {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
      return
    }
    recorderStreamRef.current?.getTracks().forEach(track => track.stop())
    recorderRef.current = null
    recorderStreamRef.current = null
    recorderPromptRef.current = ''
    recorderChunksRef.current = []
    setRecordingPromptId('')
  }

  async function startPracticeRecording(promptId: string) {
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPracticeError('This browser does not support microphone practice recording.')
      return
    }

    if (recordingPromptId && recordingPromptId !== promptId) {
      setPracticeError('Stop the current recording before starting a new prompt.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recorderChunksRef.current = []
      recorderPromptRef.current = promptId
      recorderStreamRef.current = stream
      recorderRef.current = recorder
      setPracticeError('')
      setRecordingPromptId(promptId)

      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          recorderChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const capturedPromptId = promptId
        const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const nextUrl = URL.createObjectURL(blob)
        setPracticeRecordings(current => {
          const previousUrl = current[capturedPromptId]
          if (previousUrl) URL.revokeObjectURL(previousUrl)
          return {
            ...current,
            [capturedPromptId]: nextUrl,
          }
        })
        stream.getTracks().forEach(track => track.stop())
        recorderRef.current = null
        recorderStreamRef.current = null
        recorderPromptRef.current = ''
        recorderChunksRef.current = []
        setRecordingPromptId('')
      }

      recorder.start()
    } catch {
      setPracticeError('Microphone access was blocked. Allow microphone permission to use this drill.')
      recorderStreamRef.current?.getTracks().forEach(track => track.stop())
      recorderRef.current = null
      recorderStreamRef.current = null
      recorderPromptRef.current = ''
      recorderChunksRef.current = []
      setRecordingPromptId('')
    }
  }

  if (loading) {
    return <div className="crm-shell"><div className="crm-panel p-16 text-center text-sm text-[var(--app-muted)]">Loading sales academy...</div></div>
  }

  if (error || !payload) {
    return <div className="crm-shell"><div className="crm-panel p-16 text-center text-sm text-rose-600">{error || 'Could not load academy.'}</div></div>
  }

  const overallCompletion = getOverallCompletion(modules, progress)
  const completedModules = modules.filter(module => getModuleCompletionPercent(module, progress[module.id]) === 100).length
  const scenarioWins = modules.reduce((sum, module) => {
    return sum + module.lessons.filter(lesson => {
      if (lesson.type !== 'scenario' || !lesson.scenario) return false
      const selected = getScenarioChoice(lesson, progress[module.id])
      return !!selected?.isBest
    }).length
  }, 0)
  const nextRequired = modules.find(module => module.required && getModuleCompletionPercent(module, progress[module.id]) < 100) || null
  const continueModule = nextRequired || modules.find(module => {
    const percent = getModuleCompletionPercent(module, progress[module.id])
    return percent > 0 && percent < 100
  }) || modules[0] || null
  const requiredModules = modules.filter(module => module.required)
  const recommendedModules = modules.filter(module => !module.required)
  const activeCompletion = activeModule ? getModuleCompletionPercent(activeModule, activeProgress || undefined) : 0
  const activeSectionCompletion = activeModule && activeSection
    ? getSectionCompletionPercent(activeModule, activeProgress || undefined, activeSection.id)
    : 0
  const needsAcknowledgement = !!(activeModule && activeProgress?.acknowledgedVersion !== activeModule.version)
  const lessonIndex = activeLesson && activeModule ? activeModule.lessons.findIndex(lesson => lesson.id === activeLesson.id) + 1 : 0
  const activeSectionLessonIndex = activeLesson ? activeSectionLessons.findIndex(lesson => lesson.id === activeLesson.id) + 1 : 0
  const activeLessonCompleted = !!(activeLesson && activeProgress?.completedLessons.includes(activeLesson.id))
  const activeScenarioChoice = activeLesson ? getScenarioChoice(activeLesson, activeProgress || undefined) : null
  const latestRelease = releases[0] || null
  const previousLessonId = activeLesson && activeModule ? getPreviousLessonId(activeModule, activeLesson.id) : ''
  const nextLessonId = activeLesson && activeModule ? getNextLessonId(activeModule, activeLesson.id) : ''
  const nextLesson = nextLessonId && activeModule ? activeModule.lessons.find(lesson => lesson.id === nextLessonId) || null : null
  const managerGuide = [
    'Start reps in Read First, then move them into one required course at a time.',
    'Use Tonality Lab and Phrase Bank before live shifts so reps are not finding words on real calls.',
    'Stress-test reps with harder scenarios in training than they will usually see on live calls.',
  ]

  function renderLessonBody(lesson: AcademyLesson) {
    return (
      <div className="space-y-5">
        {(lesson.type === 'card' || lesson.type === 'video') && lesson.points?.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {lesson.points.map(point => (
              <div key={point} className="rounded-[16px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 text-sm leading-6 text-[var(--app-ink)]">
                {point}
              </div>
            ))}
          </div>
        ) : null}

        {lesson.type === 'acronym' && lesson.steps?.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {lesson.steps.map(step => (
              <div key={step.letter} className="rounded-[18px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--app-ink)] text-sm font-semibold text-white">
                    {step.letter}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[var(--app-ink)]">{step.title}</div>
                    <div className="mt-1 text-sm leading-6 text-[var(--app-muted)]">{step.summary}</div>
                    {step.talkTrack ? (
                      <div className="mt-3 rounded-[12px] border border-[var(--app-line)] bg-white px-3 py-2 text-sm italic text-[var(--app-ink)]">
                        "{step.talkTrack}"
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {lesson.type === 'scenario' && lesson.scenario ? (
          <div className="space-y-4">
            <div className="rounded-[18px] border border-[var(--app-line)] bg-[var(--app-bg)] p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Scenario drill</div>
              <div className="mt-3 text-sm font-semibold text-[var(--app-ink)]">Customer says:</div>
              <div className="mt-1 text-sm italic text-[var(--app-ink)]">"{lesson.scenario.customerLine}"</div>
              <div className="mt-3 text-sm leading-6 text-[var(--app-muted)]">{lesson.scenario.setup}</div>
              <div className="mt-4 rounded-[14px] bg-white px-4 py-3 text-sm font-semibold text-[var(--app-ink)]">{lesson.scenario.prompt}</div>
            </div>
            <div className="grid gap-3">
              {lesson.scenario.options.map(option => {
                const selected = activeScenarioChoice?.id === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => recordScenario(activeModule!, lesson, option.id)}
                    className={`rounded-[18px] border p-4 text-left transition ${
                      selected
                        ? option.isBest
                          ? 'border-emerald-300 bg-emerald-50'
                          : 'border-amber-300 bg-amber-50'
                        : 'border-[var(--app-line)] bg-[var(--app-panel)] hover:border-[var(--app-ink)]'
                    }`}
                  >
                    <div className="text-sm font-semibold text-[var(--app-ink)]">{option.label}</div>
                    <div className="mt-2 text-sm leading-6 text-[var(--app-muted)]">{option.coachingNote}</div>
                  </button>
                )
              })}
            </div>
            {activeScenarioChoice ? (
              <div className={`rounded-[16px] px-4 py-3 text-sm leading-6 ${
                activeScenarioChoice.isBest ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
              }`}>
                {activeScenarioChoice.outcome}
              </div>
            ) : null}
          </div>
        ) : null}

        {lesson.type === 'flashcards' && lesson.flashcards?.length ? (
          <FlashcardGrid flashcards={lesson.flashcards} revealedCards={revealedCards} onToggle={toggleFlashcard} />
        ) : null}

        {lesson.type === 'practice' && lesson.practice ? (
          <div className="space-y-4">
            <div className="rounded-[18px] border border-[var(--app-line)] bg-[var(--app-bg)] p-5 text-sm leading-6 text-[var(--app-muted)]">
              {lesson.practice.intro}
            </div>
            {practiceError ? (
              <div className="rounded-[16px] bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {practiceError}
              </div>
            ) : null}
            <div className="grid gap-5 xl:grid-cols-[1.2fr,0.8fr]">
              <div className="space-y-4">
                {lesson.practice.prompts.map(prompt => (
                  <PracticePromptCard
                    key={prompt.id}
                    prompt={prompt}
                    recordingUrl={practiceRecordings[prompt.id]}
                    recording={recordingPromptId === prompt.id}
                    onStart={startPracticeRecording}
                    onStop={stopPracticeRecording}
                  />
                ))}
              </div>
              <div className="space-y-4">
                <div className="rounded-[18px] border border-[var(--app-line)] bg-[var(--app-bg)] p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Self-check checklist</div>
                  <div className="mt-4 space-y-3">
                    {lesson.practice.checklist.map(item => (
                      <div key={item} className="rounded-[14px] border border-[var(--app-line)] bg-white p-4 text-sm leading-6 text-[var(--app-ink)]">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
                {lesson.practice.outro ? (
                  <div className="rounded-[18px] border border-[rgba(15,106,83,0.18)] bg-[rgba(15,106,83,0.06)] p-5 text-sm leading-6 text-[var(--app-ink)]">
                    {lesson.practice.outro}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {lesson.type === 'video' ? (
          lesson.videoUrl ? (
            <div className="overflow-hidden rounded-[18px] border border-[var(--app-line)]">
              <iframe
                src={lesson.videoUrl}
                className="aspect-video w-full"
                title={lesson.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="rounded-[18px] border border-dashed border-[var(--app-line)] bg-[var(--app-bg)] px-5 py-8 text-sm text-[var(--app-muted)]">
              {lesson.videoPlaceholder || 'Video slot ready for a future walkthrough.'}
            </div>
          )
        ) : null}
      </div>
    )
  }

  return (
    <div className="crm-shell space-y-6">
      {academyView === 'library' ? (
        <>
          <section className="grid gap-4 xl:grid-cols-[1.25fr,0.75fr]">
            <div className="overflow-hidden rounded-[26px] border border-[rgba(15,106,83,0.16)] bg-[linear-gradient(135deg,#ffffff_0%,#f5fbf8_52%,#eef6f3_100%)] px-6 py-6 md:px-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(15,106,83,0.18)] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-accent)]">
                Mission Control Academy
              </div>
              <h1 className="mt-4 font-display text-[30px] font-semibold tracking-tight text-[var(--app-ink)]">
                Follow the path. Do not guess where to start.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--app-muted)]">
                This should feel like a real training path: read the company context first, move through the core sales courses
                in order, then sharpen edge cases inside labs and coaching.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[18px] border border-white bg-white/90 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Step 1</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--app-ink)]">Read First</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--app-muted)]">Brand, standards, locations, and how the company operates.</div>
                </div>
                <div className="rounded-[18px] border border-white bg-white/90 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Step 2</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--app-ink)]">Core Path</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--app-muted)]">STAR, estimating, closing, billing, tonality, and CRM rhythm.</div>
                </div>
                <div className="rounded-[18px] border border-white bg-white/90 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Step 3</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--app-ink)]">Labs</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--app-muted)]">Scenarios, reviews, drills, and future stress-test coaching.</div>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                {continueModule ? (
                  <button type="button" onClick={() => openModule(continueModule.id, 'classroom')} className="crm-button-dark">
                    Resume path
                  </button>
                ) : null}
                <Link href="/sales/read-first" className="crm-button">Read First</Link>
                <Link href="/SOPs/mission-control-map.html" target="_blank" className="crm-button">System Map</Link>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[16px] border border-white bg-white/90 p-4">
                  <div className="text-xl font-semibold text-[var(--app-ink)]">{overallCompletion}%</div>
                  <div className="mt-1 text-xs text-[var(--app-muted)]">Required path complete</div>
                </div>
                <div className="rounded-[16px] border border-white bg-white/90 p-4">
                  <div className="text-xl font-semibold text-[var(--app-ink)]">{completedModules}</div>
                  <div className="mt-1 text-xs text-[var(--app-muted)]">Courses finished</div>
                </div>
                <div className="rounded-[16px] border border-white bg-white/90 p-4">
                  <div className="text-xl font-semibold text-[var(--app-ink)]">{scenarioWins}</div>
                  <div className="mt-1 text-xs text-[var(--app-muted)]">Scenario wins</div>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="crm-panel p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Welcome back</div>
                <div className="mt-2 text-lg font-semibold text-[var(--app-ink)]">{payload.user.name}</div>
                <div className="mt-2 text-sm leading-6 text-[var(--app-muted)]">
                  {nextRequired
                    ? `Next required course: ${nextRequired.title}.`
                    : 'Required path is current. Use the labs and reviews to sharpen edge cases.'}
                </div>
                {saveMessage ? (
                  <div className={`mt-4 rounded-[12px] px-3 py-2 text-xs ${
                    saveState === 'local'
                      ? 'bg-amber-50 text-amber-700'
                      : saveState === 'synced'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}>
                    {saveMessage}
                  </div>
                ) : null}
              </div>

              {latestRelease ? (
                <div className="crm-panel p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Latest update</div>
                  <div className="mt-2 text-base font-semibold text-[var(--app-ink)]">{latestRelease.title}</div>
                  <div className="mt-1 text-xs text-[var(--app-muted)]">
                    Version {latestRelease.version} • {formatDate(latestRelease.publishedAt)}
                  </div>
                  <div className="mt-4 space-y-2">
                    {latestRelease.points.slice(0, 3).map(point => (
                      <div key={point} className="rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3 text-sm leading-6 text-[var(--app-ink)]">
                        {point}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--app-ink)]">Core learning path</h2>
              <p className="mt-1 text-sm text-[var(--app-muted)]">Start at the top and move down one course at a time. This is the main sequence.</p>
            </div>
            <div className="space-y-3">
              {requiredModules.map(module => {
                const row = progress[module.id]
                const percent = getModuleCompletionPercent(module, row)
                const needsReview = row?.acknowledgedVersion !== module.version
                const actionLabel = percent > 0 && percent < 100 ? 'Continue' : percent === 100 ? 'Review' : 'Start'
                const order = requiredModules.findIndex(item => item.id === module.id) + 1
                const highlight =
                  nextRequired?.id === module.id
                    ? 'Start here'
                    : continueModule?.id === module.id && percent > 0 && percent < 100
                      ? 'Resume here'
                      : undefined
                return (
                  <CoursePathRow
                    key={module.id}
                    module={module}
                    percent={percent}
                    needsReview={needsReview}
                    actionLabel={actionLabel}
                    order={order}
                    highlight={highlight}
                    onOpen={() => openModule(module.id, 'classroom')}
                  />
                )
              })}
            </div>
          </section>

          {recommendedModules.length > 0 ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--app-ink)]">Skill labs and coaching</h2>
                <p className="mt-1 text-sm text-[var(--app-muted)]">Use these for reinforcement, review, and edge-case training.</p>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {recommendedModules.map(module => {
                  const row = progress[module.id]
                  const percent = getModuleCompletionPercent(module, row)
                  const needsReview = row?.acknowledgedVersion !== module.version
                  const actionLabel = percent > 0 && percent < 100 ? 'Continue' : percent === 100 ? 'Review' : 'Start'
                  return (
                    <LabShelfCard
                      key={module.id}
                      module={module}
                      percent={percent}
                      needsReview={needsReview}
                      actionLabel={actionLabel}
                      onOpen={() => openModule(module.id, 'classroom')}
                    />
                  )
                })}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {academyView === 'classroom' && activeModule && activeProgress && activeLesson && activeSection ? (
        <section className="grid gap-5 xl:grid-cols-[300px,minmax(0,1fr),280px]">
          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <div className="crm-panel">
              <div className="border-b border-[var(--app-line)] px-5 py-4">
                <button
                  type="button"
                  onClick={() => {
                    stopPracticeRecording()
                    setAcademyView('library')
                  }}
                  className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-accent)]"
                >
                  ← Back to academy
                </button>
                <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Course path</div>
                <div className="mt-1 text-lg font-semibold text-[var(--app-ink)]">Training map</div>
              </div>
              <div className="space-y-3 p-3">
                {modules.map(module => {
                  const percent = getModuleCompletionPercent(module, progress[module.id])
                  const selected = module.id === activeModule.id
                  const moduleProgress = progress[module.id] || getDefaultProgress(module.id)
                  return (
                    <div key={module.id} className={`rounded-[18px] border p-2 ${selected ? 'border-[var(--app-ink)] bg-white' : 'border-[var(--app-line)] bg-[var(--app-bg)]'}`}>
                      <button type="button" onClick={() => openModule(module.id)} className="w-full text-left">
                        <div className="flex items-center justify-between gap-3 px-2 py-2">
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">{module.badge}</div>
                            <div className="mt-1 truncate text-sm font-semibold text-[var(--app-ink)]">{module.title}</div>
                          </div>
                          <div className="text-xs font-semibold text-[var(--app-muted)]">{percent}%</div>
                        </div>
                      </button>
                      {selected ? (
                        <div className="mt-2 space-y-2 px-1 pb-1">
                          {getModuleSections(module).map(section => {
                            const sectionSelected = section.id === activeSection.id
                            const sectionLessons = getSectionLessons(module, section.id)
                            const sectionPercent = getSectionCompletionPercent(module, moduleProgress, section.id)
                            return (
                              <div key={section.id} className={`rounded-[14px] border ${sectionSelected ? 'border-[var(--app-ink)] bg-[var(--app-bg)]' : 'border-[var(--app-line)] bg-white'}`}>
                                <button
                                  type="button"
                                  onClick={() => openSection(module, section.id)}
                                  className="w-full px-3 py-3 text-left"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-[var(--app-ink)]">{section.title}</div>
                                      <div className="mt-1 text-[11px] leading-5 text-[var(--app-muted)]">{sectionLessons.length} lessons</div>
                                    </div>
                                    <div className="text-xs font-semibold text-[var(--app-muted)]">{sectionPercent}%</div>
                                  </div>
                                </button>
                                {sectionSelected ? (
                                  <div className="space-y-1 px-2 pb-2">
                                    {sectionLessons.map((lesson, index) => {
                                      const done = activeProgress.completedLessons.includes(lesson.id)
                                      const isActive = lesson.id === activeLesson.id
                                      return (
                                        <button
                                          key={lesson.id}
                                          type="button"
                                          onClick={() => openLesson(module, lesson.id)}
                                          className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left transition ${
                                            isActive ? 'bg-[var(--app-ink)] text-white' : 'hover:bg-[var(--app-bg)]'
                                          }`}
                                        >
                                          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                                            isActive ? 'bg-white/15 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-[var(--app-wash)] text-[var(--app-muted)]'
                                          }`}>
                                            {done ? '✓' : index + 1}
                                          </div>
                                          <div className="min-w-0">
                                            <div className={`truncate text-sm font-medium ${isActive ? 'text-white' : 'text-[var(--app-ink)]'}`}>{lesson.title}</div>
                                            <div className={`text-[11px] ${isActive ? 'text-white/70' : 'text-[var(--app-muted)]'}`}>{LESSON_TYPE_LABELS[lesson.type]}</div>
                                          </div>
                                        </button>
                                      )
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          </aside>

          <div className="space-y-4">
            <div className="crm-panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    stopPracticeRecording()
                    setAcademyView('library')
                  }}
                  className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-accent)]"
                >
                  ← Course library
                </button>
                <button
                  type="button"
                  onClick={() => acknowledgeModule(activeModule)}
                  className={`rounded-full px-3 py-2 text-xs font-semibold ${
                    needsAcknowledgement ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {needsAcknowledgement ? 'Acknowledge update' : 'Version acknowledged'}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-[var(--app-wash)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                  {activeModule.title}
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                  {activeSection.title}
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                  {activeSectionCompletion}% section complete
                </span>
              </div>
              <div className="mt-3 text-lg font-semibold text-[var(--app-ink)]">{activeModule.title}</div>
              <div className="mt-1 text-sm leading-6 text-[var(--app-muted)]">{activeSection.summary}</div>
            </div>

            <div className="crm-panel overflow-hidden p-3">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {activeSections.map(section => {
                  const selected = section.id === activeSection.id
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => openSection(activeModule, section.id)}
                      className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                        selected
                          ? 'bg-[var(--app-ink)] text-white'
                          : 'border border-[var(--app-line)] bg-white text-[var(--app-ink)]'
                      }`}
                    >
                      {section.shortTitle || section.title}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="crm-panel p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--app-wash)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                    {activeSection.title}
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                    Lesson {activeSectionLessonIndex} of {activeSectionLessons.length} in section
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                    Module lesson {lessonIndex} of {activeModule.lessons.length}
                  </span>
                </div>
                <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">
                  {LESSON_TYPE_LABELS[activeLesson.type]}
                </div>
                <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-[var(--app-ink)]">{activeLesson.title}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-muted)]">{activeLesson.summary}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full bg-[var(--app-wash)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                    {activeLessonCompleted ? 'Lesson complete' : 'Current lesson'}
                  </span>
                  {nextLesson ? (
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                      Up next: {nextLesson.title}
                    </span>
                  ) : (
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                      Final lesson
                    </span>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {activeModule.resources.map(resource => (
                    <Link
                      key={resource.label}
                      href={resource.href}
                      target={resource.href.startsWith('/SOPs/') ? '_blank' : undefined}
                      className="rounded-full border border-[var(--app-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--app-ink)] transition hover:border-[var(--app-ink)]"
                    >
                      {resource.label}
                    </Link>
                  ))}
                </div>
                <div className="mt-6">{renderLessonBody(activeLesson)}</div>
            </div>

            <div className="crm-panel p-4 xl:sticky xl:bottom-4 xl:z-10">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={!previousLessonId}
                  onClick={() => previousLessonId && openLesson(activeModule, previousLessonId)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    previousLessonId
                      ? 'border border-[var(--app-line)] bg-white text-[var(--app-ink)]'
                      : 'cursor-not-allowed border border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-muted)]'
                  }`}
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  onClick={() => markLesson(activeModule, activeLesson.id, !activeLessonCompleted)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    activeLessonCompleted
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'border border-[var(--app-line)] bg-white text-[var(--app-ink)]'
                  }`}
                >
                  {activeLessonCompleted ? 'Completed' : 'Mark complete'}
                </button>
                <button
                  type="button"
                  onClick={() => markLessonAndMaybeAdvance(activeModule, activeLesson.id)}
                  className="crm-button-dark"
                >
                  {nextLessonId ? 'Next →' : 'Finish lesson'}
                </button>
              </div>
            </div>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <div className="space-y-4">
              <div className="crm-panel p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Current course</div>
                <div className="mt-2 text-lg font-semibold text-[var(--app-ink)]">{activeModule.title}</div>
                <div className="mt-1 text-sm leading-6 text-[var(--app-muted)]">{activeModule.objective}</div>
                <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Section progress</div>
                <div className="mt-2 text-xl font-semibold text-[var(--app-ink)]">{activeSectionCompletion}% complete</div>
                <div className="mt-1 text-sm text-[var(--app-muted)]">{activeSectionLessonIndex} of {activeSectionLessons.length} lessons viewed in this section</div>
                <div className="mt-4 h-2 rounded-full bg-[var(--app-wash)]">
                  <div className="h-2 rounded-full bg-[var(--app-accent)]" style={{ width: `${activeSectionCompletion}%` }} />
                </div>
                <div className="mt-4 rounded-[14px] bg-[var(--app-wash)] p-4">
                  <div className="text-sm font-semibold text-[var(--app-ink)]">Last opened</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--app-muted)]">{formatRelativeDate(activeProgress.lastOpenedAt)}</div>
                </div>
              </div>

              <div className="crm-panel p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Up next</div>
                <div className="mt-4 space-y-3">
                  {nextLesson ? (
                    <button
                      type="button"
                      onClick={() => openLesson(activeModule, nextLesson.id)}
                      className="w-full rounded-[16px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 text-left transition hover:border-[var(--app-ink)]"
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Next lesson</div>
                      <div className="mt-1 text-sm font-semibold text-[var(--app-ink)]">{nextLesson.title}</div>
                      <div className="mt-2 text-xs leading-5 text-[var(--app-muted)]">{nextLesson.summary}</div>
                    </button>
                  ) : (
                    <div className="rounded-[16px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 text-sm leading-6 text-[var(--app-muted)]">
                      This course is at the last lesson. Mark it complete, then move to the next course in the path.
                    </div>
                  )}
                  <div className="rounded-[16px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 text-sm leading-6 text-[var(--app-ink)]">
                    {nextRequired
                      ? `Next required course after this path: ${nextRequired.title}.`
                      : 'Required courses are current. Use the labs and coaching modules for reinforcement.'}
                  </div>
                </div>
              </div>

              <div className="crm-panel p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Tools and links</div>
                <div className="mt-4 space-y-2">
                  <Link href="/sales/read-first" className="block rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-3 text-sm font-medium text-[var(--app-ink)] transition hover:border-[var(--app-ink)]">Read First</Link>
                  <Link href="/sales/leads" className="block rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-3 text-sm font-medium text-[var(--app-ink)] transition hover:border-[var(--app-ink)]">Open live leads</Link>
                  <Link href="/sales/activity" className="block rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-3 text-sm font-medium text-[var(--app-ink)] transition hover:border-[var(--app-ink)]">Live feed</Link>
                </div>
                <div className="mt-4 space-y-2">
                  {managerGuide.map(point => (
                    <div key={point} className="rounded-[14px] border border-[var(--app-line)] bg-white p-3 text-xs leading-5 text-[var(--app-ink)]">
                      {point}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </section>
      ) : null}
    </div>
  )
}
