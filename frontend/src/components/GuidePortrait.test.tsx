import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { spriteGridFor } from "@/features/party-lobby/lib/pixelSprites";

import { GuidePortrait } from "./GuidePortrait";

describe("GuidePortrait", () => {
  it("has 32x32 art for MILO and his blink", () => {
    for (const key of ["guide:milo", "guide:milo-blink"]) {
      const grid = spriteGridFor(key);
      expect(grid).toHaveLength(32);
      expect(grid?.every((row) => row.length === 32)).toBe(true);
    }
  });

  it("draws the portrait and a blink layer that stops under reduced motion", () => {
    const { container } = render(<GuidePortrait scale={2} />);
    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveAttribute("aria-hidden", "true");
    const blink = root.querySelector(".animate-pixel-blink");
    expect(blink).toHaveClass("motion-reduce:hidden");
    // The portrait emitter carries one box-shadow per opaque pixel.
    const emitter = root.querySelector("[style*='box-shadow']") as HTMLElement;
    expect(emitter.style.boxShadow.split("#").length - 1).toBeGreaterThan(400);
  });

  it("can be labelled instead of decorative", () => {
    const { getByRole } = render(<GuidePortrait label="MILO the guide" />);
    expect(getByRole("img", { name: "MILO the guide" })).toBeInTheDocument();
  });
});
