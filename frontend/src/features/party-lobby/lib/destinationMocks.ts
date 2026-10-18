/**
 * Feature-local MOCK destination recommendations for the DISCOVER stage.
 *
 * Placeholder for the AI's destination recommendations (which come from the
 * party's combined preferences via the backend). UI-only; not a backend contract.
 * Reuses the {@link CharacterOption} shape (id + label + description) so the
 * existing `VibeCardGroup` renders them. Replace with real recommendation data
 * once the discovery backend is connected.
 */
import type { CharacterOption } from "./characterOptions";

export const MOCK_DESTINATION_OPTIONS: readonly CharacterOption[] = [
  {
    id: "tokyo",
    label: "Tokyo, Japan",
    icon: "skyline",
    description: "Neon nights, food & culture",
  },
  {
    id: "seoul",
    label: "Seoul, Korea",
    icon: "pagoda",
    description: "K-culture, markets & palaces",
  },
  {
    id: "bali",
    label: "Bali, Indonesia",
    icon: "palm",
    description: "Beaches, temples & rice terraces",
  },
  {
    id: "bangkok",
    label: "Bangkok, Thailand",
    icon: "lantern",
    description: "Street food & buzzing markets",
  },
] as const;
