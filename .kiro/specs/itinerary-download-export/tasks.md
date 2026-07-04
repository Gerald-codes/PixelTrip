# Implementation Plan: Itinerary Download Export

## Overview

Single-file refactor of `app/components/ExportButton.tsx`. The clipboard state machine, `useState`, `useRef`, clipboard API call, and fallback textarea UI are all removed. Two new pure helpers (`slugifyDestination`, `computeFilename`) and a synchronous `handleDownload` function replace them. The formatting helpers, props interface, and Tailwind pixel-art styles are preserved unchanged.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "name": "Implement pure helpers", "tasks": ["1.1", "1.2"] },
    { "wave": 2, "name": "Refactor ExportButton", "tasks": ["2.1", "2.2", "2.3"] },
    { "wave": 3, "name": "Build verification", "tasks": ["3"] }
  ]
}
```

## Tasks

- [x] 1. Implement pure helpers in `app/components/ExportButton.tsx`

  - [x] 1.1 Add `slugifyDestination` helper
    - Add `function slugifyDestination(destination: string): string` as a module-scoped function in `app/components/ExportButton.tsx`
    - Implementation: `.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 1.2 Add `computeFilename` helper
    - Add `function computeFilename(destination: string | undefined | null, format: "text" | "markdown"): string`
    - `ext` is `"md"` for `"markdown"` and `"txt"` for `"text"`
    - Returns `pixeltrip-{slug}-itinerary.{ext}` when slug is non-empty; falls back to `pixeltrip-itinerary.{ext}`
    - _Requirements: 1.4, 1.5, 2.4, 2.5_

- [x] 2. Refactor `ExportButton.tsx` — remove clipboard machinery and implement download

  - [x] 2.1 Strip all clipboard state machine code
    - Remove `useState` import and the `"idle" | "copying" | "copied" | "fallback"` state variable
    - Remove `useRef` import and `textareaRef`
    - Remove `handleClick` async function and `getContent` callback
    - Remove `useCallback` import (no longer needed)
    - Remove the fallback textarea `if` branch and close button JSX
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 2.2 Add `handleDownload` synchronous click handler inside the `ExportButton` component function
    - Call `formatAsText(itinerary, flightOption)` or `formatAsMarkdown(itinerary, flightOption)` based on `format` prop
    - Create a `Blob` with MIME type `"text/plain;charset=utf-8"` (text) or `"text/markdown;charset=utf-8"` (markdown)
    - Create object URL via `URL.createObjectURL`, set on a dynamically created `<a>` with `download` set to `computeFilename(itinerary.destination, format)`
    - Call `.click()` on the anchor, then `URL.revokeObjectURL(url)`
    - Wrap entire sequence in `try { ... } catch { /* silent */ }`
    - _Requirements: 1.2, 1.3, 1.6, 2.2, 2.3, 2.6, 6.1_

  - [x] 2.3 Update the rendered JSX
    - Label: `"📝 Download Markdown"` when `format === "markdown"`, `"📄 Download Text File"` when `format === "text"`
    - Render a single `<button type="button" onClick={handleDownload}>` with no disabled state, no conditional classes
    - Apply class string: `"border-4 border-pt-text-primary border-opacity-20 px-4 py-2 font-bold text-pt-text-primary shadow-pixel-card bg-[#4ADE80] hover:brightness-95 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"`
    - _Requirements: 1.1, 2.1, 4.1, 4.2, 4.3_

- [x] 3. Build verification
  - Run `npm run build` from the project root and confirm zero TypeScript errors
  - Run `npm run lint` and confirm zero lint errors
  - Verify by code inspection:
    - `ExportButton.tsx` contains no `useState`, `useRef`, `useCallback`, or `navigator.clipboard` references
    - Button label is `"📝 Download Markdown"` for markdown and `"📄 Download Text File"` for text
    - `slugifyDestination` and `computeFilename` are present as module-scoped functions
