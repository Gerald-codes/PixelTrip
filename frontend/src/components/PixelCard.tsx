/**
 * PixelCard — placeholder primitive shell (Foundation, Task 5).
 *
 * A blocky RPG panel with a solid border. A titled card gets a dark title bar across
 * its top, which sets the heading apart from the content. Typed shell only: renders an optional
 * title and its children in a minimally styled panel. The concrete card variants
 * (recommendation / voting / decision-summary) from `pixel-design-system.md` are
 * added later. Styling uses design-token utility classes only.
 */
import type { ReactElement, ReactNode } from "react";

export interface PixelCardProps {
  /** Optional card heading rendered in the display font. */
  title?: string;
  /** Card body content. */
  children?: ReactNode;
}

export function PixelCard({ title, children }: PixelCardProps): ReactElement {
  return (
    <section className="bg-bg-alt text-ink border-2 border-ink shadow-pixel">
      {title ? (
        // A title bar, like an RPG window: a dark strip across the top in plain
        // ink, so the heading never looks like the gold values beneath it.
        <h3 className="font-display border-b-2 border-ink bg-bg px-16 py-8 uppercase text-ink">
          {title}
        </h3>
      ) : null}
      <div className="font-body p-16">{children}</div>
    </section>
  );
}

export default PixelCard;
