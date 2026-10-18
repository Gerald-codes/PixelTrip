/**
 * Shared cross-cutting types used by the service layer.
 *
 * `Unsubscribe` is the return type of a realtime subscription: calling it
 * stops further callbacks (see `ChatService.subscribe` in the service
 * contracts and the "Chat Message Flow" section of `api-contracts.md`).
 */

/** Cancels a realtime subscription; calling it delivers zero further callbacks. */
export type Unsubscribe = () => void;
