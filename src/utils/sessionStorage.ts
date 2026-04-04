import { generatePairOrder } from '../services/pairOrderService'
import { DEFAULT_SESSION_SETTINGS, STORAGE_KEY } from '../constants/session'
import type { Session } from '../types/session'
import { buildPairIds, pairIdFor, syncSessionPairPointers } from './sessionPairs'

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as Session[]

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.map((session) => {
      const players = Array.isArray(session.players)
        ? session.players.map((player) => ({
            id: Number(player.id),
            name: String(player.name),
            score: Number(player.score) || 0,
          }))
        : []
      const explainerIndex = Number(session.explainerIndex) || 0
      const listenerIndex = Number(session.listenerIndex) || (players.length > 1 ? 1 : 0)
      const fallbackPairId = players.length > 1 ? pairIdFor(explainerIndex, listenerIndex) : null
      const normalizePairId = (pairId: string) => {
        const segments = String(pairId).split('-')

        return segments.length === 2 ? `${pairId}-0` : String(pairId)
      }
      const pairHistory = Array.isArray(session.pairHistory)
        ? session.pairHistory.map((pairId) => normalizePairId(String(pairId)))
        : fallbackPairId
          ? [fallbackPairId]
          : []
      const pairScores =
        session.pairScores && typeof session.pairScores === 'object'
          ? Object.fromEntries(
              Object.entries(session.pairScores).map(([pairId, score]) => [
                normalizePairId(pairId),
                Number(score) || 0,
              ]),
            )
          : {}
      const pairWordNumbers =
        session.pairWordNumbers && typeof session.pairWordNumbers === 'object'
          ? Object.fromEntries(
              Object.entries(session.pairWordNumbers).map(([pairId, wordNumber]) => [
                normalizePairId(pairId),
                Math.min(8, Math.max(1, Math.trunc(Number(wordNumber) || 1))),
              ]),
            )
          : {}
      const loadedSession: Session = {
        ...session,
        players,
        pairHistory,
        pairWordNumbers,
        currentPairStep: Math.min(
          Math.max(Number(session.currentPairStep) || 0, 0),
          Math.max(pairHistory.length - 1, 0),
        ),
        explainerIndex,
        listenerIndex,
        pairScores,
        settings: {
          timerDurationSeconds: Math.max(
            1,
            Number(session.settings?.timerDurationSeconds ?? DEFAULT_SESSION_SETTINGS.timerDurationSeconds),
          ),
          dingEnabled:
            typeof session.settings?.dingEnabled === 'boolean'
              ? session.settings.dingEnabled
              : DEFAULT_SESSION_SETTINGS.dingEnabled,
          dingVolume: Math.min(
            1,
            Math.max(
              0,
              Number(session.settings?.dingVolume ?? DEFAULT_SESSION_SETTINGS.dingVolume),
            ),
          ),
          repeatsPerPair: Math.max(
            1,
            Number(session.settings?.repeatsPerPair ?? DEFAULT_SESSION_SETTINGS.repeatsPerPair),
          ),
        },
      }

      const expectedPairCount = buildPairIds(
        players.length,
        loadedSession.settings.repeatsPerPair,
      ).length

      if (loadedSession.pairHistory.length !== expectedPairCount) {
        generatePairOrder(loadedSession)
      } else {
        loadedSession.pairWordNumbers = Object.fromEntries(
          loadedSession.pairHistory.map((pairId) => [
            pairId,
            loadedSession.pairWordNumbers[pairId] ?? 1,
          ]),
        )
      }

      syncSessionPairPointers(loadedSession)

      return loadedSession
    })
  } catch {
    return []
  }
}

export function saveSessions(sessions: Session[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}
