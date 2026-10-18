/**
 * Chat service contract.
 *
 * Typed method signatures only — no feature or business logic. Behaviour is
 * supplied solely by the mock (`chat.mock.ts`) or real (`chat.api.ts`)
 * implementation. Shapes mirror the "Chat Message Flow" section of
 * `api-contracts.md` (the single source of truth). No Supabase/FastAPI types
 * appear in this surface.
 */
import type { Message, Unsubscribe } from "@/types";

/** Input for {@link ChatService.sendMessage}. */
export interface SendMessageInput {
  roomId: string;
  senderId: string;
  text: string;
}

/** Callback invoked with each new message delivered on a subscription. */
export type MessageListener = (message: Message) => void;

export interface ChatService {
  sendMessage(input: SendMessageInput): Promise<Message>;
  listMessages(roomId: string): Promise<Message[]>;
  subscribe(roomId: string, onMessage: MessageListener): Unsubscribe;
}
