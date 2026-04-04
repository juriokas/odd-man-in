import type { PairDefinition, Session } from '../types/session'
import { buildPairDefinitionMap, buildPairIds, syncSessionPairPointers } from '../utils/sessionPairs'

function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function randomWordNumber() {
  return Math.floor(Math.random() * 8) + 1
}

function getRoundsPlayedByPlayer(
  playedPairIds: string[],
  pairMap: Record<string, PairDefinition>,
  playerId: number,
) {
  return playedPairIds.filter((pairId) => {
    const pair = pairMap[pairId]

    return pair !== undefined && (pair.explainerId === playerId || pair.listenerId === playerId)
  }).length
}

function getRoundsSinceParticipation(
  playedPairIds: string[],
  pairMap: Record<string, PairDefinition>,
  playerId: number,
) {
  for (let reverseIndex = playedPairIds.length - 1; reverseIndex >= 0; reverseIndex -= 1) {
    const pair = pairMap[playedPairIds[reverseIndex]]

    if (pair !== undefined && (pair.explainerId === playerId || pair.listenerId === playerId)) {
      return playedPairIds.length - 1 - reverseIndex
    }
  }

  return playedPairIds.length + 1
}

function getLastRoleForPlayer(
  playedPairIds: string[],
  pairMap: Record<string, PairDefinition>,
  playerId: number,
) {
  for (let reverseIndex = playedPairIds.length - 1; reverseIndex >= 0; reverseIndex -= 1) {
    const pair = pairMap[playedPairIds[reverseIndex]]

    if (!pair) {
      continue
    }

    if (pair.explainerId === playerId) {
      return 'explainer'
    }

    if (pair.listenerId === playerId) {
      return 'listener'
    }
  }

  return null
}

function chooseNextPairId(
  history: string[],
  remainingPairIds: string[],
  pairMap: Record<string, PairDefinition>,
) {
  if (remainingPairIds.length === 0) {
    return null
  }

  const playedPairIds = [...history]

  let candidates = [...remainingPairIds]

  const applyRule = (
    score: (pairId: string) => number,
    pick: 'min' | 'max',
  ) => {
    if (candidates.length <= 1) {
      return
    }

    const scoredCandidates = candidates.map((pairId) => ({
      pairId,
      score: score(pairId),
    }))
    const targetScore =
      pick === 'min'
        ? Math.min(...scoredCandidates.map((entry) => entry.score))
        : Math.max(...scoredCandidates.map((entry) => entry.score))

    candidates = scoredCandidates
      .filter((entry) => entry.score === targetScore)
      .map((entry) => entry.pairId)
  }

  applyRule((pairId) => {
    const pair = pairMap[pairId]

    if (!pair) {
      return Number.POSITIVE_INFINITY
    }

    return (
      getRoundsPlayedByPlayer(playedPairIds, pairMap, pair.explainerId) +
      getRoundsPlayedByPlayer(playedPairIds, pairMap, pair.listenerId)
    )
  }, 'min')

  applyRule((pairId) => {
    const pair = pairMap[pairId]

    if (!pair) {
      return Number.NEGATIVE_INFINITY
    }

    return Math.min(
      getRoundsSinceParticipation(playedPairIds, pairMap, pair.explainerId),
      getRoundsSinceParticipation(playedPairIds, pairMap, pair.listenerId),
    )
  }, 'max')

  applyRule((pairId) => {
    const pair = pairMap[pairId]

    if (!pair) {
      return Number.NEGATIVE_INFINITY
    }

    let score = 0
    const explainerLastRole = getLastRoleForPlayer(playedPairIds, pairMap, pair.explainerId)
    const listenerLastRole = getLastRoleForPlayer(playedPairIds, pairMap, pair.listenerId)

    if (explainerLastRole !== 'explainer') {
      score += 1
    }

    if (listenerLastRole !== 'listener') {
      score += 1
    }

    return score
  }, 'max')

  return randomItem(candidates)
}

export function generatePairOrder(session: Session) {
  const pairIds = buildPairIds(session.players.length, session.settings.repeatsPerPair)

  if (pairIds.length === 0) {
    session.pairHistory = []
    session.pairWordNumbers = {}
    session.currentPairStep = 0
    syncSessionPairPointers(session)
    return
  }

  const pairMap = buildPairDefinitionMap(session.players, session.settings.repeatsPerPair)
  const history: string[] = []

  while (history.length < pairIds.length) {
    const remainingPairIds = pairIds.filter((pairId) => !history.includes(pairId))
    const nextPairId = chooseNextPairId(history, remainingPairIds, pairMap)

    if (!nextPairId) {
      break
    }

    history.push(nextPairId)
  }

  session.pairHistory = history
  session.pairWordNumbers = Object.fromEntries(
    history.map((pairId) => [pairId, randomWordNumber()]),
  )
  session.currentPairStep = Math.min(
    session.currentPairStep,
    Math.max(session.pairHistory.length - 1, 0),
  )
  syncSessionPairPointers(session)
}
