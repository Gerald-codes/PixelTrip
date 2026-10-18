/**
 * Chat service — real (backend-backed) implementation.
 *
 * Placeholder for the Foundation phase: every method throws
 * {@link NotImplementedError} and performs no Supabase/FastAPI access. It holds
 * the shape of the real integration without implementing it, so all backend
 * access stays confined to the service layer. Behaviour arrives when Supabase
 * Realtime and the backend endpoints land; until then run with
 * `NEXT_PUBLIC_SERVICE_MODE=mock`.
 */
import type { Message, Unsubscribe } from "@/types";
import { notImplemented } from "@/lib/errors";
import type {
  ChatService,
  MessageListener,
  SendMessageInput,
} from "./chat.contract";

class ChatApiService implements ChatService {
  sendMessage(_input: SendMessageInput): Promise<Message> {
    throw notImplemented("ChatService.sendMessage");
  }

  listMessages(_roomId: string): Promise<Message[]> {
    throw notImplemented("ChatService.listMessages");
  }

  subscribe(_roomId: string, _onMessage: MessageListener): Unsubscribe {
    throw notImplemented("ChatService.subscribe");
  }
}

/** Singleton real Chat service placeholder. */
export const chatApiService: ChatService = new ChatApiService();
