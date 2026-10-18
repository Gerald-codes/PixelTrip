/**
 * ChatBubble — placeholder primitive shell (Foundation, Task 5).
 *
 * A chat message bubble with distinct user vs. AI styling. Typed shell only:
 * renders its children in a bordered bubble aligned/coloured by sender. Support
 * for embedded cards from `pixel-design-system.md` is added later. Styling uses
 * design-token utility classes only.
 */
import type { ReactElement, ReactNode } from "react";

export type ChatBubbleSender = "user" | "ai";

export interface ChatBubbleProps {
  /** Who sent the message; drives the bubble styling. */
  sender: ChatBubbleSender;
  /** Message content. */
  children?: ReactNode;
}

const SENDER_CLASSES: Record<ChatBubbleSender, string> = {
  user: "bg-primary text-bg border-primary-dark",
  ai: "bg-bg-alt text-ink border-muted",
};

export function ChatBubble({ sender, children }: ChatBubbleProps): ReactElement {
  return (
    <div className={`font-body border-2 p-8 ${SENDER_CLASSES[sender]}`}>
      {children}
    </div>
  );
}

export default ChatBubble;
