"use client";

/**
 * useAdventureDrawer — mobile drawer open/close state for the Adventure_Sidebar.
 *
 * On a mobile viewport the sidebar renders as a collapsible drawer rather than a
 * fixed second column (Req 17.2). This hook owns that single piece of local UI
 * state: whether the drawer is expanded. It defaults to collapsed/closed so the
 * sidebar starts out of the way on mobile, and exposes a stable `toggle` so
 * activating the drawer control expands or collapses it (Req 17.4). The consumer
 * wires `isOpen` to the sidebar's `aria-expanded` for assistive technology.
 *
 * Pure client state: no persistence, no effects, no service/backend access.
 */
import { useCallback, useState } from "react";

export interface AdventureDrawerState {
  /** Whether the mobile drawer is currently expanded. Defaults to false. */
  isOpen: boolean;
  /** Flip the drawer between expanded and collapsed. Stable across renders. */
  toggle: () => void;
  /** Explicitly expand the drawer. Stable across renders. */
  open: () => void;
  /** Explicitly collapse the drawer. Stable across renders. */
  close: () => void;
}

export function useAdventureDrawer(): AdventureDrawerState {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return { isOpen, toggle, open, close };
}
