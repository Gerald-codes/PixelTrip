/**
 * DialogueBox — placeholder primitive shell (Foundation, Task 5).
 *
 * A classic RPG text box for the AI/NPC guide. Typed shell only: renders a
 * speaker name and a line of text in a bordered box. The typewriter reveal and
 * AI-vs-user distinction from `pixel-design-system.md` are added later. Styling
 * uses design-token utility classes only.
 */
import type { ReactElement } from "react";

export interface DialogueBoxProps {
  /** Name of the speaker (e.g. the NPC guide). */
  speaker: string;
  /** The dialogue line to display. */
  text: string;
}

export function DialogueBox({ speaker, text }: DialogueBoxProps): ReactElement {
  return (
    <div className="bg-bg text-ink border-2 border-primary p-16">
      <p className="font-display text-primary mb-8">{speaker}</p>
      <p className="font-body">{text}</p>
    </div>
  );
}

export default DialogueBox;
