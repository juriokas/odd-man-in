import type { SessionSettings } from '../types/session'

export const STORAGE_KEY = 'player-order-sessions'

export const DEFAULT_DRAFT_PLAYERS = ['', '', '']

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  timerDurationSeconds: 60,
  dingEnabled: true,
  dingVolume: 0.4,
  repeatsPerPair: 1,
}
