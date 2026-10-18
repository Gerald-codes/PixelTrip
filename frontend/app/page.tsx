"use client";

import { LobbyApp } from "@/features/party-lobby";

/**
 * The App Router entry stays thin: it composes the party lobby feature, which
 * owns validation, service selection, session state, and the live waiting room.
 */
export default function HomePage() {
  return <LobbyApp />;
}
