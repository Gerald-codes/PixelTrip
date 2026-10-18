/**
 * Public surface of the party-lobby feature.
 *
 * The App Router route composes {@link LobbyApp}; the presentational components
 * and the {@link usePartyLobby} hook are exported for tests and future reuse.
 */
export { LobbyApp } from "./components/LobbyApp";
export { PartyLobby } from "./components/PartyLobby";
export type { PartyLobbyProps } from "./components/PartyLobby";
export { PartyWaitingRoom } from "./components/PartyWaitingRoom";
export type { PartyWaitingRoomProps } from "./components/PartyWaitingRoom";
export { PartyRoomShell } from "./components/PartyRoomShell";
export type { PartyRoomShellProps } from "./components/PartyRoomShell";
export { CharacterCreator } from "./components/CharacterCreator";
export type { CharacterCreatorProps } from "./components/CharacterCreator";
export type { CharacterDraft } from "./types";
export { RosterPanel } from "./components/RosterPanel";
export type { RosterPanelProps } from "./components/RosterPanel";
export { SetupStageContent } from "./components/SetupStageContent";
export type { SetupStageContentProps } from "./components/SetupStageContent";
export { StagePlaceholder } from "./components/StagePlaceholder";
export type { StagePlaceholderProps } from "./components/StagePlaceholder";
export { usePartyLobby } from "./hooks/usePartyLobby";
export type { LobbyView, PartyLobbyState } from "./hooks/usePartyLobby";
export {
  STAGES,
  STAGE_ORDER,
  buildStageSteps,
  isStageStubbed,
  stageMeta,
} from "./lib/stages";
export type { StageMeta, StageStatus, StageStep } from "./lib/stages";
