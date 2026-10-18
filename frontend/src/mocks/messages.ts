/**
 * Chat message fixtures.
 *
 * Contract-shaped `Message` data (see "Chat Message Flow" in
 * `api-contracts.md`). The `content` field's shape depends on `kind`, so it is
 * typed as `unknown` by the `Message` type. Consumed only by the mock service
 * implementations. IDs are UUID-format strings; timestamps are ISO 8601.
 */
import type { Message } from "@/types";

/** Fixture message history for {@link mockRoom}. */
export const mockMessages: readonly Message[] = [
  {
    id: "77777777-7777-4777-8777-777777777777",
    roomId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2025-01-01T09:00:00.000Z",
    senderType: "ai",
    senderId: null,
    kind: "text",
    content: {
      text: "Welcome adventurers! Where shall our journey begin?",
      options: [
        { id: "opt-japan", label: "Japan" },
        { id: "opt-korea", label: "Korea" },
        { id: "opt-europe", label: "Europe" },
        { id: "opt-surprise", label: "Surprise Me" },
      ],
      stage: "setup",
    },
  },
  {
    id: "88888888-8888-4888-8888-888888888888",
    roomId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2025-01-01T09:00:30.000Z",
    senderType: "user",
    senderId: "11111111-1111-4111-8111-111111111111",
    kind: "text",
    content: { text: "Let's start in Japan!" },
  },
];

/**
 * Template for a message emitted by the realtime `subscribe` mock. Consumers
 * receive a fresh copy with a generated id/timestamp so repeated emissions
 * stay distinct.
 */
export const mockRealtimeMessageTemplate: Omit<Message, "id" | "createdAt"> = {
  roomId: "22222222-2222-4222-8222-222222222222",
  senderType: "ai",
  senderId: null,
  kind: "text",
  content: { text: "The party gathers by the campfire...", stage: "setup" },
};
