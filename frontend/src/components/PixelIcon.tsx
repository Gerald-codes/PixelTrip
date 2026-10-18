/**
 * PixelIcon — a small 8x8 pixel-art icon, drawn in the current text colour.
 *
 * Replaces emoji, which render differently on every device and ignore the
 * palette. Each icon is an 8-row bitmap (`#` = a filled pixel) drawn as crisp SVG
 * squares, so it scales to any whole-number size without blurring.
 */
import type { ReactElement } from "react";

const ICONS = {
  // A steaming bowl.
  food: ["..#..#..", ".#..#...", "..#..#..", "........", "########", "########", ".######.", "..####.."],
  // Mountains under a sun.
  scenery: [".....##.", ".....##.", "..#.....", ".###....", "#####.#.", "#######.", "########", "########"],
  // A flag planted on a peak.
  adventure: ["..###...", "..####..", "..###...", "..#.....", "..#.....", ".###....", "#####...", "#######."],
  // A shopping bag.
  shopping: ["..####..", ".#....#.", "########", "########", "########", "########", "########", ".######."],
  // A crescent moon and a star.
  nightlife: ["..###..#", ".###....", "###.....", "###.....", "###.....", ".###...#", "..####..", "...###.."],
  // A temple front.
  culture: ["...##...", "..####..", ".######.", "########", ".#.##.#.", ".#.##.#.", ".#.##.#.", "########"],
  // A beach umbrella.
  relaxation: ["..####..", ".######.", "########", "...#....", "...#....", "...#....", "...#..#.", "....##.."],
  // A cut gem.
  "hidden-gems": [".######.", "########", "########", ".######.", "..####..", "..####..", "...##...", "...##..."],
  // Arrows going both ways.
  flexibility: [".....#..", "#######.", ".....#..", "........", "..#.....", ".#######", "..#.....", "........"],
  coin: ["..####..", ".######.", "###.####", "###.####", "###.####", "###.####", ".######.", "..####.."],
  // A money bag.
  bag: ["..#..#..", "...##...", "..####..", ".######.", "########", "########", "########", ".######."],
  // A treasure chest.
  chest: [".######.", "########", "########", "........", "###..###", "###..###", "########", "########"],
  crown: ["........", "#..##..#", "#..##..#", "##.##.##", "########", "########", "........", "########"],
  clipboard: ["..####..", "########", "#......#", "#.####.#", "#......#", "#.####.#", "#......#", "########"],
  compass: ["..####..", ".#....#.", "#...##.#", "#..##..#", "#..##..#", "#.##...#", ".#....#.", "..####.."],
  sunglasses: ["........", "........", "########", "###..###", "###..###", ".#....#.", "........", "........"],
  backpack: ["..####..", ".#....#.", ".######.", "########", "##....##", "##....##", "########", ".######."],
  pagoda: ["...##...", ".######.", "...##...", "########", "..####..", "..####..", "########", "..####.."],
  skyline: ["......#.", ".#....#.", ".#.##.#.", ".#.####.", "##.####.", "#######.", "########", "########"],
  palm: [".##.##..", "#######.", "#..#..#.", "...#....", "...#....", "..##....", "..#.....", "########"],
  boot: ["..###...", "..###...", "..###...", "..###...", "..####..", "..######", "########", "########"],
  lantern: ["...##...", "..####..", ".######.", ".#.##.#.", ".######.", ".#.##.#.", "..####..", "...##..."],
  // A torii gate.
  torii: ["########", ".######.", "..#..#..", "########", "..#..#..", "..#..#..", "..#..#..", "..#..#.."],
  map: ["##.##.##", "########", "#..#...#", "#.##.#.#", "#....#.#", "#.##...#", "########", "##.##.##"],
  star: ["...##...", "...##...", "########", ".######.", "..####..", ".######.", ".##..##.", "#......#"],
} as const satisfies Record<string, readonly string[]>;

export type PixelIconName = keyof typeof ICONS;

export function isPixelIconName(name: string): name is PixelIconName {
  return name in ICONS;
}

export interface PixelIconProps {
  name: PixelIconName;
  /** Rendered width and height in pixels; use a multiple of 8. Defaults to 24. */
  size?: number;
  /** Accessible name. Omit for a decorative icon next to visible text. */
  label?: string;
}

export function PixelIcon({ name, size = 24, label }: PixelIconProps): ReactElement {
  const rows = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      fill="currentColor"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null,
        ),
      )}
    </svg>
  );
}

export default PixelIcon;
