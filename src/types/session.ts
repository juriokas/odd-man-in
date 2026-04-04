export type Player = {
  id: number
  name: string
  score: number
}

export type SessionSettings = {
  timerDurationSeconds: number
  dingEnabled: boolean
  dingVolume: number
  repeatsPerPair: number
}

export type Session = {
  id: number
  title: string
  createdAt: string
  players: Player[]
  pairHistory: string[]
  pairWordNumbers: Record<string, number>
  currentPairStep: number
  explainerIndex: number
  listenerIndex: number
  pairScores: Record<string, number>
  settings: SessionSettings
}

export type PairDefinition = {
  id: string
  explainerIndex: number
  explainerId: number
  explainerName: string
  listenerIndex: number
  listenerId: number
  listenerName: string
}

export type SessionPair = PairDefinition & {
  score: number
  wordNumber: number
  isCurrent: boolean
  isPast: boolean
  isCompleted: boolean
}

export type PlayerProgress = {
  id: number
  completedRounds: number
  totalRounds: number
}

export type LeaderboardEntry = {
  id: number
  name: string
  score: number
  completedRounds: number
  totalRounds: number
}

export type SessionSettingsDraft = SessionSettings

export type Page = 'home' | 'new-session' | 'session'
