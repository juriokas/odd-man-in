<script setup lang="ts">
import { useSessions } from './composables/useSessions'
import { formatDate } from './utils/format'

const {
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
  currentPairCountdownMs,
  currentPairHasCommittedScore,
  sessionPairs,
  leaderboard,
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
} = useSessions()
</script>
<template src="./App.html"></template>

<style scoped src="./App.css"></style>
