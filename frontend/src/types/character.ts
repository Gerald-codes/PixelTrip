/**
 * Pixel character shape.
 *
 * Mirrors the "Character" shape in `api-contracts.md`. A character belongs to a
 * room member. `appearance` is a free-form object defined by the character
 * creator, so it is typed as an open record of `unknown` values (never `any`).
 */
export interface Character {
  id: string;
  memberId: string;
  appearance: Record<string, unknown>;
  spriteKey: string | null;
}
