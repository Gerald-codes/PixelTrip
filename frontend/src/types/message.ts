/**
 * Chat message envelope.
 *
 * Mirrors the "Chat Message Flow" contract in `api-contracts.md`. The
 * `content` shape depends on `kind`, so it is typed as `unknown` (never
 * `any`) and narrowed by consumers based on `kind`.
 */

/** Who authored a message. */
export type SenderType = "user" | "ai";

/** The kind of message, which determines the `content` shape. */
export type MessageKind = "text" | "recommendation" | "vote" | "summary";

/** A room message with a stable envelope. */
export interface Message {
  id: string;
  roomId: string;
  createdAt: string;
  senderType: SenderType;
  /** User id, or `null` for AI. */
  senderId: string | null;
  kind: MessageKind;
  /** Shape depends on `kind`; narrowed by consumers. */
  content: unknown;
}
