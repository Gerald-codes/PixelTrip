/**
 * Mock chat service.
 *
 * In-memory implementation of {@link ChatService} returning contract-shaped
 * fixture data (no Supabase/FastAPI access). `subscribe` simulates Supabase
 * Realtime with a lightweight local timer: it periodically emits a fixture
 * message and returns an {@link Unsubscribe} that clears the timer so that
 * ZERO further callbacks fire after it returns (see Requirement 7.4 and the
 * design's realtime `subscribe` spec).
 */
import type { Message, Unsubscribe } from "@/types";
import { mockMessages, mockRealtimeMessageTemplate } from "@/mocks";
import type {
  ChatService,
  MessageListener,
  SendMessageInput,
} from "./chat.contract";

/** Interval between simulated realtime emissions, in milliseconds. */
const EMIT_INTERVAL_MS = 3000;

export class MockChatService implements ChatService {
  async sendMessage(input: SendMessageInput): Promise<Message> {
    const message: Message = {
      id: crypto.randomUUID(),
      roomId: input.roomId,
      createdAt: new Date().toISOString(),
      senderType: "user",
      senderId: input.senderId,
      kind: "text",
      content: { text: input.text },
    };
    return Promise.resolve(message);
  }

  async listMessages(roomId: string): Promise<Message[]> {
    return Promise.resolve(
      mockMessages.filter((message) => message.roomId === roomId),
    );
  }

  subscribe(roomId: string, onMessage: MessageListener): Unsubscribe {
    let active = true;

    const timer = setInterval(() => {
      // Guard against any callback slipping through after unsubscribe.
      if (!active) {
        return;
      }
      const message: Message = {
        ...mockRealtimeMessageTemplate,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        roomId,
      };
      onMessage(message);
    }, EMIT_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }
}
