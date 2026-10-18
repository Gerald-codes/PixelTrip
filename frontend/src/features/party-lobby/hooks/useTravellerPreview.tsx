"use client";

/**
 * The traveller being created, shared between the character form (which edits it)
 * and the sidebar (which shows it live, so it stays in view while the form
 * scrolls). `null` whenever nobody is creating a traveller in this tab.
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import type { CharacterDraft } from "../types";

export interface TravellerPreview {
  draft: CharacterDraft;
  /** The player's name, shown on the card. */
  name: string;
}

interface TravellerPreviewValue {
  preview: TravellerPreview | null;
  setPreview: (preview: TravellerPreview | null) => void;
}

const Context = createContext<TravellerPreviewValue | null>(null);

export function TravellerPreviewProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const [preview, setPreview] = useState<TravellerPreview | null>(null);
  const value = useMemo(() => ({ preview, setPreview }), [preview]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The traveller in progress, or `null`. Safe outside a provider (always `null`). */
export function useTravellerPreview(): TravellerPreview | null {
  return useContext(Context)?.preview ?? null;
}

/** How the form publishes its draft. A no-op outside a provider. */
export function useSetTravellerPreview(): (preview: TravellerPreview | null) => void {
  const context = useContext(Context);
  return context?.setPreview ?? noop;
}

function noop(): void {}
