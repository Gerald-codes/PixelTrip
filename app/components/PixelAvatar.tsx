"use client";

/**
 * PixelAvatar — layered SVG pixel-art avatar component.
 *
 * Renders four absolutely-positioned SVG layers stacked in z-order:
 *   1. Base body  (z-index 1) — always "default"
 *   2. Outfit     (z-index 2) — driven by avatarConfig.outfit
 *   3. Headwear   (z-index 3) — driven by avatarConfig.headwear
 *   4. Handheld   (z-index 4) — driven by avatarConfig.handheldItem
 *
 * Palette:
 *   Sky blue    #38BDF8
 *   Sunset orange #FB923C
 *   Sand cream  #FEF3C7
 *   Grass green #4ADE80
 *   Deep navy   #1E3A5F
 *   Neon purple #A855F7
 */

import React from "react";
import type { AvatarConfig } from "@/lib/types";

// ─── Prop types ──────────────────────────────────────────────────────────────

export interface PixelAvatarProps {
  avatarConfig: AvatarConfig;
  size?: "sm" | "md" | "lg";
}

// ─── Size map ────────────────────────────────────────────────────────────────

const SIZE_MAP: Record<"sm" | "md" | "lg", { width: number; height: number }> =
  {
    sm: { width: 32, height: 48 },
    md: { width: 64, height: 96 },
    lg: { width: 96, height: 144 },
  };

// ─── Shared SVG wrapper ──────────────────────────────────────────────────────

interface LayerProps {
  zIndex: number;
  children: React.ReactNode;
}

function Layer({ zIndex, children }: LayerProps) {
  return (
    <svg
      viewBox="0 0 32 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex,
        overflow: "visible",
      }}
    >
      {children}
    </svg>
  );
}

// ─── Layer 1: Base body ──────────────────────────────────────────────────────

function BaseBodyDefault() {
  // Simple humanoid pixel silhouette
  // Head: 10x10 centered at x=11, y=2 (sand cream skin)
  // Neck: 4x3 at x=14, y=12
  // Torso: 14x12 at x=9, y=15 (deep navy)
  // Arms: left 4x10 at x=5, y=15 | right 4x10 at x=23, y=15 (deep navy)
  // Legs: left 6x11 at x=9, y=27 | right 6x11 at x=17, y=27 (deep navy)
  // Shoes: left 6x4 at x=9, y=38 | right 6x4 at x=17, y=38 (dark)
  return (
    <>
      {/* Head */}
      <rect x="11" y="2" width="10" height="10" fill="#FEF3C7" />
      {/* Eyes */}
      <rect x="13" y="5" width="2" height="2" fill="#1E3A5F" />
      <rect x="17" y="5" width="2" height="2" fill="#1E3A5F" />
      {/* Mouth */}
      <rect x="14" y="9" width="4" height="1" fill="#FB923C" />
      {/* Neck */}
      <rect x="14" y="12" width="4" height="3" fill="#FEF3C7" />
      {/* Torso */}
      <rect x="9" y="15" width="14" height="12" fill="#38BDF8" />
      {/* Left arm */}
      <rect x="5" y="15" width="4" height="10" fill="#38BDF8" />
      {/* Right arm */}
      <rect x="23" y="15" width="4" height="10" fill="#38BDF8" />
      {/* Left hand */}
      <rect x="5" y="25" width="4" height="3" fill="#FEF3C7" />
      {/* Right hand */}
      <rect x="23" y="25" width="4" height="3" fill="#FEF3C7" />
      {/* Left leg */}
      <rect x="9" y="27" width="6" height="11" fill="#1E3A5F" />
      {/* Right leg */}
      <rect x="17" y="27" width="6" height="11" fill="#1E3A5F" />
      {/* Left shoe */}
      <rect x="8" y="38" width="8" height="4" fill="#1E3A5F" />
      {/* Right shoe */}
      <rect x="16" y="38" width="8" height="4" fill="#1E3A5F" />
    </>
  );
}

// ─── Layer 2: Outfits ────────────────────────────────────────────────────────

function OutfitBackpacker() {
  // Simple shirt (grass green) + small backpack on back (sunset orange)
  return (
    <>
      {/* Shirt over torso */}
      <rect x="9" y="15" width="14" height="12" fill="#4ADE80" />
      {/* Shirt collar */}
      <rect x="13" y="15" width="6" height="2" fill="#FEF3C7" />
      {/* Left sleeve */}
      <rect x="5" y="15" width="4" height="8" fill="#4ADE80" />
      {/* Right sleeve */}
      <rect x="23" y="15" width="4" height="8" fill="#4ADE80" />
      {/* Backpack body */}
      <rect x="19" y="14" width="6" height="9" fill="#FB923C" />
      {/* Backpack strap left */}
      <rect x="19" y="13" width="2" height="3" fill="#FB923C" />
      {/* Backpack pocket */}
      <rect x="20" y="17" width="4" height="3" fill="#FEF3C7" />
    </>
  );
}

function OutfitCasual() {
  // Jacket/hoodie (sky blue darker shade) + travel bag on left
  return (
    <>
      {/* Hoodie body */}
      <rect x="9" y="15" width="14" height="12" fill="#1E3A5F" />
      {/* Hoodie pocket */}
      <rect x="12" y="22" width="8" height="4" fill="#38BDF8" />
      {/* Hood flap */}
      <rect x="11" y="13" width="10" height="4" fill="#1E3A5F" />
      {/* Hoodie strings */}
      <rect x="14" y="15" width="1" height="4" fill="#FEF3C7" />
      <rect x="17" y="15" width="1" height="4" fill="#FEF3C7" />
      {/* Left sleeve */}
      <rect x="5" y="15" width="4" height="10" fill="#1E3A5F" />
      {/* Right sleeve */}
      <rect x="23" y="15" width="4" height="10" fill="#1E3A5F" />
      {/* Travel bag */}
      <rect x="1" y="19" width="5" height="7" fill="#FB923C" />
      {/* Bag handle */}
      <rect x="2" y="17" width="3" height="3" fill="#FB923C" />
      {/* Bag strap */}
      <rect x="5" y="20" width="3" height="2" fill="#FEF3C7" />
    </>
  );
}

function OutfitLuxury() {
  // Stylish jacket (neon purple) + suitcase on right
  return (
    <>
      {/* Jacket body */}
      <rect x="9" y="15" width="14" height="12" fill="#A855F7" />
      {/* Jacket lapels */}
      <polygon points="16,15 13,21 16,21" fill="#FEF3C7" />
      <polygon points="16,15 19,21 16,21" fill="#FEF3C7" />
      {/* Jacket buttons */}
      <rect x="15" y="22" width="2" height="2" fill="#1E3A5F" />
      {/* Left sleeve */}
      <rect x="5" y="15" width="4" height="10" fill="#A855F7" />
      {/* Right sleeve */}
      <rect x="23" y="15" width="4" height="10" fill="#A855F7" />
      {/* Cufflinks */}
      <rect x="23" y="23" width="4" height="1" fill="#FEF3C7" />
      <rect x="5" y="23" width="4" height="1" fill="#FEF3C7" />
      {/* Suitcase body */}
      <rect x="26" y="20" width="6" height="8" rx="1" fill="#FEF3C7" />
      {/* Suitcase handle */}
      <rect x="27" y="18" width="4" height="3" fill="#1E3A5F" />
      <rect x="27" y="18" width="1" height="3" fill="#1E3A5F" />
      <rect x="30" y="18" width="1" height="3" fill="#1E3A5F" />
      {/* Suitcase latch */}
      <rect x="28" y="24" width="2" height="1" fill="#FB923C" />
    </>
  );
}

// ─── Layer 3: Headwear ───────────────────────────────────────────────────────

function HeadwearCaptainHat() {
  // Explorer/captain hat — wide brim + tall crown
  return (
    <>
      {/* Brim */}
      <rect x="8" y="5" width="16" height="2" fill="#1E3A5F" />
      {/* Crown */}
      <rect x="11" y="0" width="10" height="6" fill="#1E3A5F" />
      {/* Hat band */}
      <rect x="11" y="4" width="10" height="2" fill="#FB923C" />
      {/* Anchor badge */}
      <rect x="15" y="1" width="2" height="3" fill="#FEF3C7" />
      <rect x="14" y="3" width="4" height="1" fill="#FEF3C7" />
    </>
  );
}

function HeadwearCapGlasses() {
  // Baseball cap + pixel glasses
  return (
    <>
      {/* Cap brim */}
      <rect x="9" y="6" width="14" height="2" fill="#38BDF8" />
      {/* Cap dome */}
      <rect x="11" y="1" width="10" height="6" fill="#38BDF8" />
      {/* Cap button top */}
      <rect x="15" y="0" width="2" height="2" fill="#1E3A5F" />
      {/* Glasses frames */}
      <rect x="11" y="8" width="4" height="3" fill="none" stroke="#1E3A5F" strokeWidth="1" />
      <rect x="17" y="8" width="4" height="3" fill="none" stroke="#1E3A5F" strokeWidth="1" />
      {/* Glasses bridge */}
      <rect x="15" y="9" width="2" height="1" fill="#1E3A5F" />
      {/* Left temple */}
      <rect x="10" y="9" width="1" height="1" fill="#1E3A5F" />
      {/* Right temple */}
      <rect x="21" y="9" width="1" height="1" fill="#1E3A5F" />
    </>
  );
}

function HeadwearVillagerHat() {
  // Simple rounded straw hat
  return (
    <>
      {/* Wide brim */}
      <rect x="7" y="5" width="18" height="2" fill="#FB923C" />
      {/* Hat top dome */}
      <rect x="11" y="1" width="10" height="5" fill="#FEF3C7" />
      {/* Hat band */}
      <rect x="11" y="4" width="10" height="2" fill="#4ADE80" />
    </>
  );
}

function HeadwearBeanie() {
  // Beanie + headphones arc
  return (
    <>
      {/* Beanie body */}
      <rect x="11" y="1" width="10" height="7" fill="#A855F7" />
      {/* Beanie ribbing lines */}
      <rect x="11" y="5" width="10" height="1" fill="#1E3A5F" />
      <rect x="11" y="7" width="10" height="1" fill="#1E3A5F" />
      {/* Pom-pom */}
      <rect x="14" y="0" width="4" height="2" fill="#FEF3C7" />
      {/* Headphone arc */}
      <rect x="9" y="3" width="2" height="5" fill="#1E3A5F" />
      <rect x="21" y="3" width="2" height="5" fill="#1E3A5F" />
      <rect x="9" y="3" width="14" height="2" fill="#1E3A5F" />
      {/* Ear cups */}
      <rect x="8" y="6" width="3" height="4" fill="#38BDF8" />
      <rect x="21" y="6" width="3" height="4" fill="#38BDF8" />
    </>
  );
}

function HeadwearExplorerHat() {
  // Wide-brim explorer/safari hat
  return (
    <>
      {/* Wide brim */}
      <rect x="6" y="5" width="20" height="3" fill="#FB923C" />
      {/* Crown */}
      <rect x="11" y="1" width="10" height="5" fill="#FB923C" />
      {/* Hat indent crease */}
      <rect x="13" y="1" width="6" height="1" fill="#FEF3C7" />
      {/* Chin strap */}
      <rect x="11" y="8" width="2" height="3" fill="#FEF3C7" />
      <rect x="19" y="8" width="2" height="3" fill="#FEF3C7" />
      {/* Hat band */}
      <rect x="11" y="4" width="10" height="2" fill="#4ADE80" />
    </>
  );
}

// ─── Layer 4: Handheld items ─────────────────────────────────────────────────

function HandheldBubbleTea() {
  // Cup with straw held in right hand area
  return (
    <>
      {/* Cup body */}
      <rect x="24" y="22" width="5" height="8" fill="#FEF3C7" />
      {/* Cup tapered bottom */}
      <rect x="25" y="29" width="3" height="2" fill="#FEF3C7" />
      {/* Liquid */}
      <rect x="24" y="24" width="5" height="5" fill="#FB923C" />
      {/* Bubbles */}
      <rect x="25" y="26" width="1" height="1" fill="#1E3A5F" />
      <rect x="27" y="27" width="1" height="1" fill="#1E3A5F" />
      {/* Straw */}
      <rect x="27" y="18" width="2" height="7" fill="#4ADE80" />
      {/* Lid */}
      <rect x="24" y="21" width="5" height="2" fill="#38BDF8" />
    </>
  );
}

function HandheldCamera() {
  // Simple blocky camera in right hand
  return (
    <>
      {/* Camera body */}
      <rect x="23" y="21" width="8" height="6" fill="#1E3A5F" />
      {/* Lens */}
      <rect x="25" y="22" width="4" height="4" fill="#38BDF8" />
      <rect x="26" y="23" width="2" height="2" fill="#FEF3C7" />
      {/* Flash */}
      <rect x="23" y="20" width="3" height="2" fill="#FEF3C7" />
      {/* Viewfinder bump */}
      <rect x="27" y="20" width="3" height="2" fill="#1E3A5F" />
      {/* Shutter button */}
      <rect x="28" y="19" width="2" height="2" fill="#FB923C" />
      {/* Strap */}
      <rect x="23" y="18" width="1" height="4" fill="#FB923C" />
    </>
  );
}

function HandheldHikingStick() {
  // Walking/hiking stick on right side
  return (
    <>
      {/* Stick shaft */}
      <rect x="28" y="14" width="2" height="28" fill="#FB923C" />
      {/* Handle top */}
      <rect x="26" y="14" width="6" height="2" fill="#1E3A5F" />
      {/* Tip point */}
      <rect x="28" y="42" width="2" height="3" fill="#1E3A5F" />
      {/* Mid grip band */}
      <rect x="27" y="24" width="4" height="2" fill="#4ADE80" />
    </>
  );
}

function HandheldShoppingBag() {
  // Bag with handles in right hand
  return (
    <>
      {/* Bag body */}
      <rect x="23" y="24" width="8" height="10" fill="#A855F7" />
      {/* Handles */}
      <rect x="25" y="21" width="2" height="4" fill="#1E3A5F" />
      <rect x="29" y="21" width="2" height="4" fill="#1E3A5F" />
      {/* Bag fold top */}
      <rect x="23" y="24" width="8" height="2" fill="#1E3A5F" />
      {/* Logo star */}
      <rect x="26" y="27" width="1" height="3" fill="#FEF3C7" />
      <rect x="25" y="28" width="3" height="1" fill="#FEF3C7" />
    </>
  );
}

function HandheldNeonCup() {
  // Glowing cup with neon effect
  return (
    <>
      {/* Glow halo */}
      <rect x="22" y="20" width="10" height="12" fill="#A855F7" opacity={0.25} />
      {/* Cup body */}
      <rect x="24" y="22" width="6" height="9" fill="#1E3A5F" />
      {/* Neon liquid */}
      <rect x="24" y="24" width="6" height="6" fill="#A855F7" />
      {/* Rim */}
      <rect x="24" y="22" width="6" height="2" fill="#FB923C" />
      {/* Straw */}
      <rect x="28" y="18" width="2" height="6" fill="#38BDF8" />
      {/* Neon shine line */}
      <rect x="25" y="25" width="1" height="4" fill="#FEF3C7" opacity={0.6} />
    </>
  );
}

function HandheldGuidebook() {
  // Open book / guidebook in right hand
  return (
    <>
      {/* Left page */}
      <rect x="22" y="22" width="5" height="8" fill="#FEF3C7" />
      {/* Right page */}
      <rect x="27" y="22" width="5" height="8" fill="#FEF3C7" />
      {/* Spine */}
      <rect x="26" y="22" width="2" height="8" fill="#FB923C" />
      {/* Left text lines */}
      <rect x="23" y="24" width="3" height="1" fill="#1E3A5F" />
      <rect x="23" y="26" width="3" height="1" fill="#1E3A5F" />
      <rect x="23" y="28" width="3" height="1" fill="#1E3A5F" />
      {/* Right text lines */}
      <rect x="28" y="24" width="3" height="1" fill="#1E3A5F" />
      <rect x="28" y="26" width="3" height="1" fill="#1E3A5F" />
      <rect x="28" y="28" width="3" height="1" fill="#1E3A5F" />
      {/* Cover top */}
      <rect x="22" y="20" width="10" height="2" fill="#38BDF8" />
    </>
  );
}

function HandheldHeadphones() {
  // Over-ear headphone arc on right hand (held out)
  return (
    <>
      {/* Arc */}
      <rect x="24" y="20" width="8" height="2" fill="#1E3A5F" />
      {/* Left cup */}
      <rect x="23" y="21" width="3" height="5" fill="#38BDF8" />
      {/* Right cup */}
      <rect x="30" y="21" width="3" height="5" fill="#38BDF8" />
      {/* Left stem */}
      <rect x="24" y="22" width="1" height="3" fill="#1E3A5F" />
      {/* Right stem */}
      <rect x="31" y="22" width="1" height="3" fill="#1E3A5F" />
      {/* Cushion highlights */}
      <rect x="24" y="22" width="2" height="3" fill="#A855F7" />
      <rect x="30" y="22" width="2" height="3" fill="#A855F7" />
    </>
  );
}

function HandheldCompass() {
  // Compass circle
  return (
    <>
      {/* Outer ring */}
      <rect x="23" y="20" width="10" height="10" fill="#FEF3C7" />
      {/* Inner face */}
      <rect x="24" y="21" width="8" height="8" fill="#1E3A5F" />
      {/* N needle */}
      <polygon points="28,22 27,27 29,27" fill="#FB923C" />
      {/* S needle */}
      <polygon points="28,30 27,27 29,27" fill="#FEF3C7" />
      {/* Center dot */}
      <rect x="27" y="27" width="2" height="2" fill="#38BDF8" />
      {/* Cardinal labels */}
      <rect x="27" y="21" width="2" height="1" fill="#FEF3C7" />
    </>
  );
}

function HandheldMap() {
  // Folded map
  return (
    <>
      {/* Map body */}
      <rect x="22" y="21" width="10" height="8" fill="#FEF3C7" />
      {/* Fold crease vertical */}
      <rect x="27" y="21" width="1" height="8" fill="#FB923C" />
      {/* Fold crease horizontal */}
      <rect x="22" y="25" width="10" height="1" fill="#FB923C" />
      {/* Route line */}
      <rect x="23" y="22" width="3" height="1" fill="#38BDF8" />
      <rect x="25" y="22" width="1" height="2" fill="#38BDF8" />
      <rect x="25" y="23" width="2" height="1" fill="#38BDF8" />
      {/* Location pin */}
      <rect x="28" y="26" width="2" height="2" fill="#A855F7" />
      <rect x="27" y="27" width="4" height="1" fill="#A855F7" />
      {/* Map border */}
      <rect x="22" y="21" width="10" height="1" fill="#1E3A5F" />
      <rect x="22" y="28" width="10" height="1" fill="#1E3A5F" />
    </>
  );
}

// ─── Lookup maps ─────────────────────────────────────────────────────────────

const BASE_BODY_LAYERS: Record<string, React.FC> = {
  default: BaseBodyDefault,
};

const OUTFIT_LAYERS: Record<string, React.FC> = {
  backpacker: OutfitBackpacker,
  casual: OutfitCasual,
  luxury: OutfitLuxury,
};

const HEADWEAR_LAYERS: Record<string, React.FC> = {
  captain_hat: HeadwearCaptainHat,
  cap_glasses: HeadwearCapGlasses,
  villager_hat: HeadwearVillagerHat,
  beanie: HeadwearBeanie,
  explorer_hat: HeadwearExplorerHat,
};

const HANDHELD_LAYERS: Record<string, React.FC> = {
  bubble_tea: HandheldBubbleTea,
  camera: HandheldCamera,
  hiking_stick: HandheldHikingStick,
  shopping_bag: HandheldShoppingBag,
  neon_cup: HandheldNeonCup,
  guidebook: HandheldGuidebook,
  headphones: HandheldHeadphones,
  compass: HandheldCompass,
  map: HandheldMap,
};

/** Resolves a layer component from a lookup map, falling back to the first entry. */
function resolveLayer(
  map: Record<string, React.FC>,
  key: string,
  layerName: string
): React.FC {
  if (key in map) return map[key];
  console.warn(
    `[PixelAvatar] Unknown ${layerName} key "${key}". Falling back to default.`
  );
  return Object.values(map)[0];
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PixelAvatar({
  avatarConfig,
  size = "md",
}: PixelAvatarProps) {
  const { width, height } = SIZE_MAP[size];

  const BaseBodyComponent = resolveLayer(
    BASE_BODY_LAYERS,
    avatarConfig.baseBody,
    "baseBody"
  );
  const OutfitComponent = resolveLayer(
    OUTFIT_LAYERS,
    avatarConfig.outfit,
    "outfit"
  );
  const HeadwearComponent = resolveLayer(
    HEADWEAR_LAYERS,
    avatarConfig.headwear,
    "headwear"
  );
  const HandheldComponent = resolveLayer(
    HANDHELD_LAYERS,
    avatarConfig.handheldItem,
    "handheldItem"
  );

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        imageRendering: "pixelated",
        // @ts-expect-error — crisp-edges is valid CSS but not in React CSSProperties
        WebkitImageRendering: "crisp-edges",
      }}
      // crisp-edges via className for browsers that support it natively
      className="pixel-avatar"
    >
      {/* Layer 1 — Base body */}
      <Layer zIndex={1}>
        <BaseBodyComponent />
      </Layer>

      {/* Layer 2 — Outfit */}
      <Layer zIndex={2}>
        <OutfitComponent />
      </Layer>

      {/* Layer 3 — Headwear */}
      <Layer zIndex={3}>
        <HeadwearComponent />
      </Layer>

      {/* Layer 4 — Handheld item */}
      <Layer zIndex={4}>
        <HandheldComponent />
      </Layer>
    </div>
  );
}
