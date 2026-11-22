import type { Lane } from "@lol-viewer/protocol";
import type { ViewerMode } from "@lol-viewer/core";

export const LANE_LABEL: Record<Lane, string> = { top: "Top", jungle: "Jungle", middle: "Mid", bottom: "Bot", support: "Support" };
export const LANE_SHORT: Record<Lane, string> = { top: "TOP", jungle: "JG", middle: "MID", bottom: "BOT", support: "SUP" };
export const MODE_LABEL: Record<ViewerMode, string> = { build: "Build", counter: "Counter", aram: "ARAM" };
export const MODES: readonly ViewerMode[] = ["build", "counter", "aram"];

const PHASE_LABEL: Record<string, string> = {
  None: "Idle",
  Lobby: "Lobby",
  Matchmaking: "Matchmaking",
  ReadyCheck: "Ready check",
  ChampSelect: "Champ Select",
  GameStart: "Game starting",
  InProgress: "In Game",
  Reconnect: "Reconnect",
  WaitingForStats: "Waiting for stats",
  PreEndOfGame: "Game over",
  EndOfGame: "Game over",
};
export const phaseLabel = (phase: string): string => PHASE_LABEL[phase] ?? phase;
