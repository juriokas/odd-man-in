import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { DEFAULT_DRAFT_PLAYERS, DEFAULT_SESSION_SETTINGS } from '../constants/session'
import type {
  LeaderboardEntry,
  Page,
  PairDefinition,
  PlayerProgress,
  Session,
  SessionPair,
  SessionSettings,
  SessionSettingsDraft,
} from '../types/session'
import { generatePairOrder } from '../services/pairOrderService'
import { buildPairDefinitions, syncSessionPairPointers } from '../utils/sessionPairs'
import { loadSessions, saveSessions } from '../utils/sessionStorage'

function cloneSettings(settings: SessionSettings): SessionSettingsDraft {
  return { ...settings }
}

function normalizeSettings(settings: SessionSettingsDraft): SessionSettings {
  return {
    timerDurationSeconds: Math.max(1, Math.trunc(Number(settings.timerDurationSeconds) || 1)),
    dingEnabled: Boolean(settings.dingEnabled),
    dingVolume: Math.min(1, Math.max(0, Number(settings.dingVolume) || 0)),
    repeatsPerPair: Math.max(1, Math.trunc(Number(settings.repeatsPerPair) || 1)),
  }
}

function getPlayerCount(names: string[]) {
  return names.map((name) => name.trim()).filter(Boolean).length
}

function getRoundsPerPlayer(playerCount: number, repeatsPerPair: number) {
  return Math.max((playerCount - 1) * repeatsPerPair * 2, 0)
}

function getTotalRounds(playerCount: number, repeatsPerPair: number) {
  return Math.max(playerCount * (playerCount - 1) * repeatsPerPair, 0)
}

export function useSessions() {
  const TIMER_TICK_MS = 50
  const TIMER_DONE_BLINK_MS = 900

  const sessions = ref<Session[]>(loadSessions())
  const page = ref<Page>('home')
  const draftPlayers = ref([...DEFAULT_DRAFT_PLAYERS])
  const draftSettings = ref<SessionSettingsDraft>(cloneSettings(DEFAULT_SESSION_SETTINGS))
  const activeSessionId = ref<number | null>(sessions.value[0]?.id ?? null)
  const showPlayerNameErrors = ref(false)
  const isSettingsDialogOpen = ref(false)
  const sessionSettingsDraft = ref<SessionSettingsDraft>(cloneSettings(DEFAULT_SESSION_SETTINGS))

  const currentPairCountdownMs = ref(DEFAULT_SESSION_SETTINGS.timerDurationSeconds * 1000)
  const isCurrentPairTimerRunning = ref(false)
  const isCurrentPairReadyForScoring = ref(false)
  const isTimerDoneBlinking = ref(false)
  const currentPairScoreInput = ref('')
  const scoreInputRef = ref<HTMLInputElement | null>(null)
  const playerNameInputRefs = ref<HTMLInputElement[]>([])
  const scoreOptions = Array.from({ length: 21 }, (_, index) => index)

  let currentPairTimerHandle: ReturnType<typeof setInterval> | null = null
  let currentPairTimerEndsAt = 0
  let timerDoneBlinkTimeoutHandle: ReturnType<typeof setTimeout> | null = null
  let audioContext: AudioContext | null = null
  let hasPrimedAudio = false

  const activeSession = computed(
    () => sessions.value.find((session) => session.id === activeSessionId.value) ?? null,
  )

  const currentTimerDurationMs = computed(
    () => (activeSession.value?.settings.timerDurationSeconds ?? DEFAULT_SESSION_SETTINGS.timerDurationSeconds) * 1000,
  )

  const currentPairPosition = computed(() => activeSession.value?.currentPairStep ?? -1)
  const isOnLastPair = computed(() => {
    const session = activeSession.value

    if (!session) {
      return false
    }

    return session.currentPairStep >= session.pairHistory.length - 1
  })

  const draftPlayerCount = computed(() => getPlayerCount(draftPlayers.value))
  const draftTotalRounds = computed(() =>
    getTotalRounds(draftPlayerCount.value, draftSettings.value.repeatsPerPair),
  )

  const formattedCurrentPairCountdown = computed(() => {
    const totalMilliseconds = Math.max(currentPairCountdownMs.value, 0)
    const totalTenths = Math.ceil(totalMilliseconds / 100)
    const minutes = Math.floor(totalTenths / 600)
    const seconds = Math.floor((totalTenths % 600) / 10)
    const tenths = totalTenths % 10

    return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`
  })

  const pairDefinitions = computed<PairDefinition[]>(() => {
    const session = activeSession.value

    if (!session) {
      return []
    }

    return buildPairDefinitions(session.players, session.settings.repeatsPerPair)
  })

  const pairDefinitionMap = computed<Record<string, PairDefinition>>(() =>
    Object.fromEntries(pairDefinitions.value.map((pair) => [pair.id, pair])),
  )

  const currentPairId = computed(() => {
    const session = activeSession.value

    if (!session) {
      return null
    }

    return session.pairHistory[session.currentPairStep] ?? null
  })

  const currentPairHasCommittedScore = computed(() => {
    const session = activeSession.value
    const pairId = currentPairId.value

    if (!session || !pairId) {
      return false
    }

    return Object.prototype.hasOwnProperty.call(session.pairScores, pairId)
  })

  const sessionPairs = computed<SessionPair[]>(() => {
    const session = activeSession.value

    if (!session) {
      return []
    }

    return session.pairHistory
      .map((pairId, index) => {
        const pair = pairDefinitionMap.value[pairId]

        if (!pair) {
          return null
        }

        const isCompleted = Object.prototype.hasOwnProperty.call(session.pairScores, pairId)

        return {
          ...pair,
          score: session.pairScores[pairId] ?? 0,
          wordNumber: session.pairWordNumbers[pairId] ?? 1,
          isCurrent: pairId === currentPairId.value,
          isPast: index < session.currentPairStep,
          isCompleted,
        }
      })
      .filter((pair): pair is NonNullable<typeof pair> => pair !== null)
  })

  const playerProgress = computed<PlayerProgress[]>(() => {
    const session = activeSession.value

    if (!session) {
      return []
    }

    const totalRoundsPerPlayer = getRoundsPerPlayer(
      session.players.length,
      session.settings.repeatsPerPair,
    )

    return session.players.map((player) => {
      const completedRounds = sessionPairs.value
        .filter((pair) => pair.explainerId === player.id || pair.listenerId === player.id)
        .filter((pair) => pair.isCompleted).length

      return {
        id: player.id,
        completedRounds,
        totalRounds: totalRoundsPerPlayer,
      }
    })
  })

  const leaderboard = computed<LeaderboardEntry[]>(() => {
    const session = activeSession.value

    if (!session) {
      return []
    }

    const completedPairs = sessionPairs.value.filter((pair) => pair.isCompleted)

    return session.players
      .map((player) => {
        const progress = playerProgress.value.find((entry) => entry.id === player.id)
        const score = completedPairs.reduce((total, pair) => {
          if (pair.explainerId !== player.id && pair.listenerId !== player.id) {
            return total
          }

          return total + pair.score
        }, 0)

        return {
          id: player.id,
          name: player.name,
          score,
          completedRounds: progress?.completedRounds ?? 0,
          totalRounds: progress?.totalRounds ?? 0,
        }
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }

        if (right.completedRounds !== left.completedRounds) {
          return right.completedRounds - left.completedRounds
        }

        return left.name.localeCompare(right.name)
      })
  })

  watch(
    sessions,
    (value) => {
      saveSessions(value)
    },
    { deep: true },
  )

  watch(currentPairId, () => {
    resetCurrentPairInteraction()
  })

  watch(
    isCurrentPairReadyForScoring,
    async (isReady) => {
      if (!isReady) {
        return
      }

      await focusScoreInput()
    },
    { flush: 'post' },
  )

  onMounted(() => {
    window.addEventListener('keydown', handleWindowKeydown)
    window.addEventListener('pointerdown', primeAudioOnInteraction, { passive: true })
    window.addEventListener('keydown', primeAudioOnInteraction)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleWindowKeydown)
    window.removeEventListener('pointerdown', primeAudioOnInteraction)
    window.removeEventListener('keydown', primeAudioOnInteraction)
    clearCurrentPairTimer()
    clearTimerDoneBlink()
  })

  function primeAudioOnInteraction() {
    if (hasPrimedAudio) {
      return
    }

    hasPrimedAudio = true
    void primeAudio()
  }

  async function getAudioContext() {
    if (typeof window === 'undefined') {
      return null
    }

    const AudioContextConstructor = window.AudioContext

    if (!AudioContextConstructor) {
      return null
    }

    if (audioContext === null) {
      audioContext = new AudioContextConstructor()
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    return audioContext
  }

  async function primeAudio() {
    const context = await getAudioContext()

    if (!context) {
      return
    }

    const silentGain = context.createGain()
    const oscillator = context.createOscillator()
    const startAt = context.currentTime

    silentGain.gain.setValueAtTime(0.0001, startAt)
    oscillator.frequency.setValueAtTime(440, startAt)
    oscillator.connect(silentGain)
    silentGain.connect(context.destination)
    oscillator.start(startAt)
    oscillator.stop(startAt + 0.01)
  }

  async function playTimerDoneSound(
    settings: Pick<SessionSettings, 'dingEnabled' | 'dingVolume'>,
    preview = false,
  ) {
    if (!settings.dingEnabled && !preview) {
      return
    }

    const context = await getAudioContext()

    if (!context) {
      return
    }

    const startAt = context.currentTime
    const volume = Math.max(settings.dingVolume, 0.001)

    for (let index = 0; index < 3; index += 1) {
      const dingStart = startAt + index * 0.28
      const masterGain = context.createGain()
      const partials = [
        { frequency: 520, gain: 0.9, type: 'triangle' as OscillatorType },
        { frequency: 780, gain: 0.55, type: 'sine' as OscillatorType },
        { frequency: 1040, gain: 0.35, type: 'sine' as OscillatorType },
      ]

      masterGain.connect(context.destination)
      masterGain.gain.setValueAtTime(0.0001, dingStart)
      masterGain.gain.exponentialRampToValueAtTime(1.2 * volume, dingStart + 0.01)
      masterGain.gain.exponentialRampToValueAtTime(0.18 * volume, dingStart + 0.18)
      masterGain.gain.exponentialRampToValueAtTime(0.0001, dingStart + 0.65)

      partials.forEach((partial) => {
        const oscillator = context.createOscillator()
        const partialGain = context.createGain()

        oscillator.type = partial.type
        oscillator.frequency.setValueAtTime(partial.frequency, dingStart)
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(partial.frequency * 0.94, 1),
          dingStart + 0.65,
        )

        partialGain.gain.setValueAtTime(partial.gain, dingStart)
        partialGain.gain.exponentialRampToValueAtTime(0.0001, dingStart + 0.65)

        oscillator.connect(partialGain)
        partialGain.connect(masterGain)
        oscillator.start(dingStart)
        oscillator.stop(dingStart + 0.65)
      })
    }
  }

  function clearCurrentPairTimer() {
    if (currentPairTimerHandle !== null) {
      clearInterval(currentPairTimerHandle)
      currentPairTimerHandle = null
    }
  }

  function clearTimerDoneBlink() {
    if (timerDoneBlinkTimeoutHandle !== null) {
      clearTimeout(timerDoneBlinkTimeoutHandle)
      timerDoneBlinkTimeoutHandle = null
    }

    isTimerDoneBlinking.value = false
  }

  function triggerTimerDoneBlink() {
    clearTimerDoneBlink()
    isTimerDoneBlinking.value = true
    timerDoneBlinkTimeoutHandle = setTimeout(() => {
      isTimerDoneBlinking.value = false
      timerDoneBlinkTimeoutHandle = null
    }, TIMER_DONE_BLINK_MS)
  }

  function resetCurrentPairInteraction() {
    clearCurrentPairTimer()
    clearTimerDoneBlink()
    isCurrentPairTimerRunning.value = false
    isCurrentPairReadyForScoring.value = currentPairHasCommittedScore.value
    currentPairCountdownMs.value = currentTimerDurationMs.value
    currentPairTimerEndsAt = 0

    const session = activeSession.value
    const pairId = currentPairId.value

    currentPairScoreInput.value =
      session && pairId && Object.prototype.hasOwnProperty.call(session.pairScores, pairId)
        ? String(session.pairScores[pairId])
        : ''
  }

  async function focusScoreInput() {
    await nextTick()

    const focus = () => {
      const input =
        scoreInputRef.value ??
        document.querySelector<HTMLInputElement>('.score-input')

      if (!input) {
        return false
      }

      input.focus({ preventScroll: true })
      input.select()
      return document.activeElement === input
    }

    if (focus()) {
      return
    }

    requestAnimationFrame(() => {
      if (focus()) {
        return
      }

      setTimeout(() => {
        if (focus()) {
          return
        }

        setTimeout(() => {
          focus()
        }, 100)
      }, 25)
    })
  }

  function setScoreInputRef(element: Element | null) {
    scoreInputRef.value = element instanceof HTMLInputElement ? element : null
  }

  function setPlayerNameInputRef(index: number, element: Element | null) {
    if (element instanceof HTMLInputElement) {
      playerNameInputRefs.value[index] = element
      return
    }

    playerNameInputRefs.value.splice(index, 1)
  }

  function focusNextPlayerField(index: number) {
    const nextInput = playerNameInputRefs.value[index + 1]

    if (!nextInput) {
      return
    }

    nextInput.focus()
    nextInput.select()
  }

  function handlePlayerNameFieldAdvance(index: number, event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      focusNextPlayerField(index)
      return
    }

    if (event.key === 'Tab' && !event.shiftKey && playerNameInputRefs.value[index + 1]) {
      event.preventDefault()
      focusNextPlayerField(index)
    }
  }

  function addPlayerField() {
    draftPlayers.value.push('')
  }

  function removePlayerField(index: number) {
    draftPlayers.value.splice(index, 1)
    playerNameInputRefs.value.splice(index, 1)
  }

  function openNewSession() {
    draftPlayers.value = [...DEFAULT_DRAFT_PLAYERS]
    draftSettings.value = cloneSettings(DEFAULT_SESSION_SETTINGS)
    showPlayerNameErrors.value = false
    page.value = 'new-session'
  }

  function openSession(sessionId: number) {
    activeSessionId.value = sessionId
    page.value = 'session'
  }

  function goHome() {
    isSettingsDialogOpen.value = false
    page.value = 'home'
  }

  function createSession() {
    const trimmedNames = draftPlayers.value.map((name) => name.trim())
    const names = trimmedNames.filter(Boolean)

    if (names.length < 2 || trimmedNames.some((name) => name.length === 0)) {
      showPlayerNameErrors.value = true
      return
    }

    const createdAt = new Date().toISOString()
    const sessionId = Date.now()
    const newSession: Session = {
      id: sessionId,
      title: names.join(', '),
      createdAt,
      pairHistory: [],
      pairWordNumbers: {},
      currentPairStep: 0,
      explainerIndex: 0,
      listenerIndex: 1,
      pairScores: {},
      settings: normalizeSettings(draftSettings.value),
      players: names.map((name, index) => ({
        id: sessionId + index + 1,
        name,
        score: 0,
      })),
    }

    generatePairOrder(newSession)
    sessions.value = [newSession, ...sessions.value]
    showPlayerNameErrors.value = false
    openSession(sessionId)
    resetCurrentPairInteraction()
  }

  function hasPlayerNameError(index: number) {
    return showPlayerNameErrors.value && (draftPlayers.value[index] ?? '').trim().length === 0
  }

  function removeSession(sessionId: number) {
    sessions.value = sessions.value.filter((session) => session.id !== sessionId)

    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value[0]?.id ?? null
    }

    if (page.value === 'session' && activeSessionId.value === null) {
      page.value = 'home'
    }
  }

  function openSettingsDialog() {
    if (!activeSession.value) {
      return
    }

    sessionSettingsDraft.value = cloneSettings(activeSession.value.settings)
    isSettingsDialogOpen.value = true
  }

  function closeSettingsDialog() {
    isSettingsDialogOpen.value = false
  }

  function saveSessionSettings() {
    const session = activeSession.value

    if (!session) {
      return
    }

    const nextSettings = normalizeSettings(sessionSettingsDraft.value)
    const repeatsChanged = session.settings.repeatsPerPair !== nextSettings.repeatsPerPair

    session.settings = nextSettings

    if (repeatsChanged) {
      session.pairScores = {}
      session.currentPairStep = 0
      generatePairOrder(session)
      syncSessionPairPointers(session)
    }

    resetCurrentPairInteraction()
    isSettingsDialogOpen.value = false
  }

  function previewDraftDingVolume() {
    void playTimerDoneSound(
      {
        dingEnabled: true,
        dingVolume: normalizeSettings(draftSettings.value).dingVolume,
      },
      true,
    )
  }

  function previewSessionDingVolume() {
    void playTimerDoneSound(
      {
        dingEnabled: true,
        dingVolume: normalizeSettings(sessionSettingsDraft.value).dingVolume,
      },
      true,
    )
  }

  function setCurrentPairScore(value: number) {
    const session = activeSession.value
    const currentPair = sessionPairs.value.find((pair) => pair.isCurrent)

    if (!session || !currentPair || !isCurrentPairReadyForScoring.value) {
      return
    }

    const normalizedValue = Math.max(0, Math.trunc(value))
    session.pairScores[currentPair.id] = normalizedValue
    currentPairScoreInput.value = String(normalizedValue)
  }

  function resetCurrentPairScore() {
    const session = activeSession.value
    const pairId = currentPairId.value

    if (!session || !pairId) {
      return
    }

    delete session.pairScores[pairId]
    clearCurrentPairTimer()
    clearTimerDoneBlink()
    isCurrentPairTimerRunning.value = false
    isCurrentPairReadyForScoring.value = false
    currentPairCountdownMs.value = currentTimerDurationMs.value
    currentPairTimerEndsAt = 0
    currentPairScoreInput.value = ''
  }

  function setCurrentPairScoreFromInput(value: string) {
    currentPairScoreInput.value = value

    if (value.trim() === '') {
      return
    }

    const parsed = Number(value)

    if (Number.isNaN(parsed)) {
      return
    }

    setCurrentPairScore(parsed)
  }

  function handleCurrentPairScoreInput(event: Event) {
    const target = event.target

    if (!(target instanceof HTMLInputElement)) {
      return
    }

    setCurrentPairScoreFromInput(target.value)
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (page.value !== 'session' || !activeSession.value || !currentPairId.value || isSettingsDialogOpen.value) {
      return
    }

    if (event.code === 'Space' && !isCurrentPairReadyForScoring.value) {
      event.preventDefault()

      if (isCurrentPairTimerRunning.value) {
        pauseCurrentPairTimer()
      } else {
        startCurrentPairTimer()
      }

      return
    }

    if (event.key !== 'Enter' || !isCurrentPairReadyForScoring.value) {
      return
    }

    const target = event.target

    if (
      target instanceof HTMLButtonElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement && target !== scoreInputRef.value)
    ) {
      return
    }

    event.preventDefault()
    advanceOrder()
  }

  function startCurrentPairTimer() {
    if (isCurrentPairTimerRunning.value || isCurrentPairReadyForScoring.value || !currentPairId.value) {
      return
    }

    clearCurrentPairTimer()
    clearTimerDoneBlink()
    currentPairTimerEndsAt = performance.now() + currentPairCountdownMs.value
    isCurrentPairTimerRunning.value = true

    currentPairTimerHandle = setInterval(() => {
      const remainingMs = Math.max(Math.ceil(currentPairTimerEndsAt - performance.now()), 0)

      currentPairCountdownMs.value = remainingMs

      if (remainingMs <= 0) {
        clearCurrentPairTimer()
        currentPairCountdownMs.value = 0
        isCurrentPairTimerRunning.value = false
        isCurrentPairReadyForScoring.value = true
        currentPairScoreInput.value = currentPairHasCommittedScore.value ? currentPairScoreInput.value : ''
        triggerTimerDoneBlink()
        void focusScoreInput()

        if (activeSession.value) {
          void playTimerDoneSound(activeSession.value.settings)
        }
        return
      }
    }, TIMER_TICK_MS)
  }

  function pauseCurrentPairTimer() {
    if (!isCurrentPairTimerRunning.value) {
      return
    }

    clearCurrentPairTimer()
    currentPairCountdownMs.value = Math.max(Math.ceil(currentPairTimerEndsAt - performance.now()), 0)
    isCurrentPairTimerRunning.value = false
    currentPairTimerEndsAt = 0
  }

  function resetCurrentPairTimer() {
    clearCurrentPairTimer()
    clearTimerDoneBlink()
    isCurrentPairTimerRunning.value = false
    isCurrentPairReadyForScoring.value = false
    currentPairCountdownMs.value = currentTimerDurationMs.value
    currentPairTimerEndsAt = 0
  }

  function advanceOrder() {
    const session = activeSession.value

    if (!session || session.currentPairStep > session.pairHistory.length - 1) {
      return
    }

    session.currentPairStep = Math.min(session.currentPairStep + 1, session.pairHistory.length)
    syncSessionPairPointers(session)
  }

  function previousOrder() {
    const session = activeSession.value

    if (!session || session.currentPairStep <= 0) {
      return
    }

    session.currentPairStep -= 1
    syncSessionPairPointers(session)
  }

  return {
    sessions,
    page,
    draftPlayers,
    draftSettings,
    draftTotalRounds,
    activeSession,
    currentPairPosition,
    isOnLastPair,
    isSettingsDialogOpen,
    sessionSettingsDraft,
    isTimerDoneBlinking,
    formattedCurrentPairCountdown,
    currentPairHasCommittedScore,
    sessionPairs,
    playerProgress,
    leaderboard,
    currentPairCountdownMs,
    isCurrentPairTimerRunning,
    isCurrentPairReadyForScoring,
    currentPairScoreInput,
    setScoreInputRef,
    setPlayerNameInputRef,
    scoreOptions,
    addPlayerField,
    removePlayerField,
    handlePlayerNameFieldAdvance,
    openNewSession,
    openSession,
    goHome,
    createSession,
    hasPlayerNameError,
    removeSession,
    openSettingsDialog,
    closeSettingsDialog,
    saveSessionSettings,
    previewDraftDingVolume,
    previewSessionDingVolume,
    setCurrentPairScore,
    resetCurrentPairScore,
    handleCurrentPairScoreInput,
    startCurrentPairTimer,
    pauseCurrentPairTimer,
    resetCurrentPairTimer,
    advanceOrder,
    previousOrder,
  }
}
