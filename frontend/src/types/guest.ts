/**
 * Guest profile (no auth).
 *
 * Mirrors the "Guest Identity Flow" contract in `api-contracts.md`. A guest is a
 * lightweight display/avatar record created by the backend when someone creates
 * or joins a room — never by the client. Identity is the room member, not the
 * guest. `avatarUrl` is `null` when not set.
 */
export interface Guest {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}
