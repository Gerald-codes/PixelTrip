/**
 * Barrel for the shared pixel design-system primitives.
 *
 * Import primitives from `@/components` rather than reaching into individual
 * files, and never fork a copy into a feature — extend these shared primitives
 * instead.
 *
 * Only the primitives whose source files currently exist are re-exported here.
 * The richer card/journal/roster primitives were removed alongside the old data
 * model; re-add their exports when their files return to `src/components`.
 */
export { PixelButton } from "./PixelButton";
export type { PixelButtonProps, PixelButtonVariant } from "./PixelButton";

export { PixelCard } from "./PixelCard";
export type { PixelCardProps } from "./PixelCard";

export { DialogueBox } from "./DialogueBox";
export type { DialogueBoxProps } from "./DialogueBox";

export { ChatBubble } from "./ChatBubble";
export type { ChatBubbleProps, ChatBubbleSender } from "./ChatBubble";

export { CharacterSprite } from "./CharacterSprite";
export type { CharacterSpriteProps, CharacterSpriteSize } from "./CharacterSprite";
