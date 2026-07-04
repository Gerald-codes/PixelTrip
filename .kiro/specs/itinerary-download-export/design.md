# Design Document — Itinerary Download Export

## Overview

This is a focused, single-file refactor of `app/components/ExportButton.tsx`. The component currently implements a copy-to-clipboard workflow backed by a state machine (`"idle" | "copying" | "copied" | "fallback"`), a textarea ref, and a `navigator.clipboard.writeText` call with a fallback textarea UI. All of that is removed and replaced with a simple browser-download pattern using the `<a href="blob:...">` technique.

The result is a stateless functional component: no `useState`, no `useRef`, no async clipboard operations. The two formatting helpers (`formatAsMarkdown`, `formatAsText`), the `ExportButtonProps` interface, and all Tailwind pixel-art classes are preserved without change.

---

## Architecture

The refactored component is entirely client-side and requires no new routes, libraries, or API calls.

```
ExportButton (client component)
│
├── Props (unchanged): { itinerary, format, flightOption }
│
├── Helpers (unchanged):
│   ├── formatDate(dateStr) → string
│   ├── flightLabel(option) → string
│   ├── formatAsText(itinerary, flightOption) → string
│   └── formatAsMarkdown(itinerary, flightOption) → string
│
├── slugifyDestination(destination) → string   [new pure helper]
├── computeFilename(destination, format) → string  [new pure helper]
│
└── handleDownload()   [new click handler — synchronous, no state]
    ├── 1. Call format helper to get content string
    ├── 2. Create Blob from content string
    ├── 3. Create object URL  (URL.createObjectURL)
    ├── 4. Create <a> element, set href + download attribute
    ├── 5. Programmatically click the anchor
    ├── 6. Revoke the object URL  (URL.revokeObjectURL)
    └── 7. Catch any error silently (no visible error state)
```

---

## Component Design

### ExportButtonProps (unchanged)

```typescript
interface ExportButtonProps {
  itinerary: Itinerary;
  format: "text" | "markdown";
  flightOption?: "budget" | "comfort" | "best_value" | null;
}
```

### New pure helpers

#### `slugifyDestination(destination: string): string`

Converts a destination string into a URL/filename-safe slug:

1. Trim leading/trailing whitespace.
2. Convert to lowercase.
3. Replace one or more consecutive whitespace characters with a single hyphen.
4. Remove all characters that are not lowercase alphanumeric (`a-z`, `0-9`) or hyphen (`-`).

```typescript
function slugifyDestination(destination: string): string {
  return destination
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
```

#### `computeFilename(destination: string | undefined | null, format: "text" | "markdown"): string`

Returns the download filename based on the itinerary destination and format:

```typescript
function computeFilename(
  destination: string | undefined | null,
  format: "text" | "markdown"
): string {
  const ext = format === "markdown" ? "md" : "txt";
  const slug = destination ? slugifyDestination(destination) : "";
  if (!slug) {
    return `pixeltrip-itinerary.${ext}`;
  }
  return `pixeltrip-${slug}-itinerary.${ext}`;
}
```

### Download handler

```typescript
function handleDownload(): void {
  try {
    const content =
      format === "text"
        ? formatAsText(itinerary, flightOption)
        : formatAsMarkdown(itinerary, flightOption);

    const mimeType =
      format === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8";

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = computeFilename(itinerary.destination, format);
    a.click();

    URL.revokeObjectURL(url);
  } catch {
    // Silent failure — no error state, no visual change
  }
}
```

### Rendered JSX

The component renders a single `<button>` element. No conditional fallback UI, no disabled states based on async operation progress.

```typescript
export default function ExportButton({
  itinerary,
  format,
  flightOption,
}: ExportButtonProps) {
  const label =
    format === "text" ? "📄 Download Text File" : "📝 Download Markdown";

  return (
    <button
      type="button"
      onClick={handleDownload}
      className={[
        "border-4 border-pt-text-primary border-opacity-20 px-4 py-2 font-bold text-pt-text-primary",
        "shadow-pixel-card",
        "bg-[#4ADE80]",
        "hover:brightness-95 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
```

---

## Data Models

No new data models are introduced. The component consumes the existing `Itinerary` type from `lib/types.ts`:

```typescript
interface Itinerary {
  id: string;
  roomId: string;
  versionNumber: number;
  destination: string;       // used for filename slugification
  startDate: string;
  endDate: string;
  days: ItineraryDay[];
  fairnessSummary: FairnessSummary;
  averageSatisfactionScore: number | null;
  status: "draft" | "final";
}
```

---

## Interfaces

### Input

| Prop | Type | Required | Notes |
|---|---|---|---|
| `itinerary` | `Itinerary` | Yes | Full itinerary object from `lib/types.ts` |
| `format` | `"text" \| "markdown"` | Yes | Determines formatter and file extension |
| `flightOption` | `"budget" \| "comfort" \| "best_value" \| null` | No | Passed through to formatter |

### Outputs

| Trigger | Output |
|---|---|
| Button click (markdown) | File download: `pixeltrip-{slug}-itinerary.md` or `pixeltrip-itinerary.md` |
| Button click (text) | File download: `pixeltrip-{slug}-itinerary.txt` or `pixeltrip-itinerary.txt` |
| Error during download | Nothing — silent suppression |

---

## Error Handling

The `handleDownload` function wraps the entire download sequence in a `try/catch`. Any error — `URL.createObjectURL` throwing, `document.createElement` failing, the anchor `click()` throwing — is caught and discarded. The component renders no error state and the button appearance does not change. This satisfies Requirement 6.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Slug character invariant

For any destination string, the output of `slugifyDestination` shall contain only lowercase letters (`a-z`), digits (`0-9`), and hyphens (`-`). No uppercase letters, whitespace, or special characters shall appear in the result.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 2: Filename construction round-trip

For any non-empty destination string `d` and any format value `f ∈ {"text", "markdown"}`, the filename returned by `computeFilename(d, f)` shall match the pattern `pixeltrip-{slugifyDestination(d)}-itinerary.{ext}` where `ext` is `"txt"` when `f === "text"` and `"md"` when `f === "markdown"`. Equivalently: extracting the middle segment of the filename and reversing the slug transformation should recover a lowercase, hyphen-normalised form of the original destination.

**Validates: Requirements 1.4, 2.4**

---

## Testing Strategy

### Unit tests (example-based)

Focus on concrete, observable behaviors:

- Rendering with `format="markdown"` shows "📝 Download Markdown"
- Rendering with `format="text"` shows "📄 Download Text File"
- Clicking calls `formatAsMarkdown` / `formatAsText` with the supplied props
- Clicking creates a Blob, creates an anchor with `href` and `download` set, calls `a.click()`
- `URL.revokeObjectURL` is called after the anchor click
- Empty / absent destination falls back to `pixeltrip-itinerary.md` and `pixeltrip-itinerary.txt`
- Error thrown by `URL.createObjectURL` does not alter the rendered button or throw to the caller
- Expected Tailwind class names are present on the button element

### Property-based tests

Both properties above are pure functions suitable for property-based testing with fast-check or similar:

**Property 1** — Generate arbitrary strings as destination input, call `slugifyDestination`, assert the output matches `/^[a-z0-9-]*$/`.

**Property 2** — Generate arbitrary non-empty destination strings and arbitrary format values, call `computeFilename`, assert the returned string matches the expected pattern using the independently computed slug.

Minimum 100 iterations per property. Tag format: `Feature: itinerary-download-export, Property {N}: {property_text}`.
