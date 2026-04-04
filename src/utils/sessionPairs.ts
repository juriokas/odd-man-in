import type { PairDefinition, Player, Session } from '../types/session'

function parsePairId(pairId: string) {
  const [explainerIndex, listenerIndex] = pairId.split('-').map(Number)

  if (explainerIndex === undefined || listenerIndex === undefined) {
    return null
  }

  return { explainerIndex, listenerIndex }
}

export function pairIdFor(
  explainerIndex: number,
  listenerIndex: number,
  repeatIndex = 0,
) {
  return `${explainerIndex}-${listenerIndex}-${repeatIndex}`
}

export function buildPairIds(playerCount: number, repeatsPerPair = 1) {
  const pairIds: string[] = []

  for (let explainerIndex = 0; explainerIndex < playerCount; explainerIndex += 1) {
    for (let listenerIndex = 0; listenerIndex < playerCount; listenerIndex += 1) {
      if (explainerIndex === listenerIndex) {
        continue
      }

      for (let repeatIndex = 0; repeatIndex < repeatsPerPair; repeatIndex += 1) {
        pairIds.push(pairIdFor(explainerIndex, listenerIndex, repeatIndex))
      }
    }
  }

  return pairIds
}

export function buildPairDefinitions(players: Player[], repeatsPerPair = 1): PairDefinition[] {
  return buildPairIds(players.length, repeatsPerPair).flatMap((pairId) => {
    const parsedPair = parsePairId(pairId)

    if (!parsedPair) {
      return []
    }

    const { explainerIndex, listenerIndex } = parsedPair
    const explainer = players[explainerIndex]
    const listener = players[listenerIndex]

    if (!explainer || !listener) {
      return []
    }

    return {
      id: pairId,
      explainerIndex,
      explainerId: explainer.id,
      explainerName: explainer.name,
      listenerIndex,
      listenerId: listener.id,
      listenerName: listener.name,
    }
  })
}

export function buildPairDefinitionMap(players: Player[], repeatsPerPair = 1) {
  return Object.fromEntries(
    buildPairDefinitions(players, repeatsPerPair).map((pair) => [pair.id, pair]),
  )
}

export function syncSessionPairPointers(session: Session) {
  const currentPairId = session.pairHistory[session.currentPairStep]

  if (!currentPairId) {
    session.explainerIndex = 0
    session.listenerIndex = 1
    return
  }

  const parsedPair = parsePairId(currentPairId)

  if (!parsedPair) {
    session.explainerIndex = 0
    session.listenerIndex = 1
    return
  }

  const { explainerIndex, listenerIndex } = parsedPair
  session.explainerIndex = explainerIndex
  session.listenerIndex = listenerIndex
}
