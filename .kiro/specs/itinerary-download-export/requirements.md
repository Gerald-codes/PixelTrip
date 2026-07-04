# Requirements Document

## Introduction

Replace the clipboard-copy buttons in `ExportButton.tsx` with browser download buttons. The "Copy as Markdown" and "Copy as Text" buttons are removed entirely. In their place, "Download Markdown" and "Download Text File" buttons trigger a browser file download using a `<a>` element with an `href` pointing to a Blob URL. The download filename is derived from the itinerary destination; if no destination is available, a fallback filename is used. All formatting helpers, the `ExportButtonProps` interface, and existing Tailwind pixel-art button styles are preserved. The clipboard state machine, textarea ref, clipboard API call, and fallback textarea UI are removed.

## Glossary

- **ExportButton**: The React client component defined in `app/components/ExportButton.tsx` that renders a single export action button.
- **Blob URL**: A temporary `blob:` URL created by `URL.createObjectURL` pointing to a `Blob` containing the formatted itinerary text.
- **Slugified destination**: The `itinerary.destination` string with whitespace and non-alphanumeric characters replaced by hyphens and converted to lowercase, used as part of the download filename.
- **Fallback filename**: The filename used when the destination string is empty or absent — `pixeltrip-itinerary.md` or `pixeltrip-itinerary.txt`.
- **formatAsText**: Existing helper that formats the itinerary as plain text.
- **formatAsMarkdown**: Existing helper that formats the itinerary as Markdown.
- **ExportButtonProps**: The existing TypeScript interface `{ itinerary: Itinerary; format: "text" | "markdown"; flightOption?: ... }`.

## Requirements

### Requirement 1 — Download Markdown button

**User Story:** As a trip member, I want to download the itinerary as a Markdown file, so that I can save it locally and share it with others.

#### Acceptance Criteria

1. WHEN `format` is `"markdown"`, THE ExportButton SHALL render a button labelled "📝 Download Markdown".
2. WHEN the user clicks the Download Markdown button, THE ExportButton SHALL call `formatAsMarkdown` with the provided `itinerary` and `flightOption` to produce the file content.
3. WHEN the user clicks the Download Markdown button, THE ExportButton SHALL trigger a browser file download using a dynamically created anchor element with a Blob URL set as `href` and `download` attribute set to the computed filename.
4. WHEN `itinerary.destination` is a non-empty string, THE ExportButton SHALL set the Markdown download filename to `pixeltrip-{slugified-destination}-itinerary.md`.
5. IF `itinerary.destination` is empty or absent, THEN THE ExportButton SHALL set the Markdown download filename to `pixeltrip-itinerary.md`.
6. WHEN the download is triggered, THE ExportButton SHALL revoke the Blob URL after the anchor click to release the object URL.

### Requirement 2 — Download Text File button

**User Story:** As a trip member, I want to download the itinerary as a plain text file, so that I can open it in any editor without Markdown syntax.

#### Acceptance Criteria

1. WHEN `format` is `"text"`, THE ExportButton SHALL render a button labelled "📄 Download Text File".
2. WHEN the user clicks the Download Text File button, THE ExportButton SHALL call `formatAsText` with the provided `itinerary` and `flightOption` to produce the file content.
3. WHEN the user clicks the Download Text File button, THE ExportButton SHALL trigger a browser file download using a dynamically created anchor element with a Blob URL set as `href` and `download` attribute set to the computed filename.
4. WHEN `itinerary.destination` is a non-empty string, THE ExportButton SHALL set the text download filename to `pixeltrip-{slugified-destination}-itinerary.txt`.
5. IF `itinerary.destination` is empty or absent, THEN THE ExportButton SHALL set the text download filename to `pixeltrip-itinerary.txt`.
6. WHEN the download is triggered, THE ExportButton SHALL revoke the Blob URL after the anchor click to release the object URL.

### Requirement 3 — Filename slugification

**User Story:** As a trip member, I want the downloaded filename to reflect my destination, so that I can identify the file easily.

#### Acceptance Criteria

1. THE ExportButton SHALL derive the slugified destination by converting `itinerary.destination` to lowercase.
2. THE ExportButton SHALL replace one or more consecutive whitespace characters in the destination with a single hyphen when forming the slug.
3. THE ExportButton SHALL remove characters that are not alphanumeric or hyphens from the slug.

### Requirement 4 — Preserved interface and styles

**User Story:** As a developer, I want the button to retain the existing prop interface and visual design, so that no call sites or design tokens need to change.

#### Acceptance Criteria

1. THE ExportButton SHALL accept the existing `ExportButtonProps` interface unchanged: `itinerary`, `format`, and optional `flightOption`.
2. THE ExportButton SHALL apply the existing Tailwind pixel-art button class set: `border-4 border-pt-text-primary border-opacity-20 px-4 py-2 font-bold text-pt-text-primary shadow-pixel-card` with `bg-[#4ADE80]` as the default background.
3. THE ExportButton SHALL apply the existing interactive Tailwind classes: `hover:brightness-95 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none`.

### Requirement 5 — Removal of clipboard machinery

**User Story:** As a developer, I want the clipboard state machine and fallback UI removed, so that the component is simpler and has no dead code paths.

#### Acceptance Criteria

1. THE ExportButton SHALL NOT import or use `useState` for a copy/fallback state machine.
2. THE ExportButton SHALL NOT import or use `useRef` for a textarea element.
3. THE ExportButton SHALL NOT contain a fallback textarea UI or a close button.
4. THE ExportButton SHALL NOT call `navigator.clipboard.writeText` or any Clipboard API method.
5. THE ExportButton SHALL remain a single-file change scoped to `app/components/ExportButton.tsx`.

### Requirement 6 — Silent failure on download error

**User Story:** As a trip member, I want the button to do nothing visible if the download cannot be triggered, so that the UI stays clean without unexpected error states.

#### Acceptance Criteria

1. IF the Blob URL cannot be created or the anchor click cannot be dispatched, THEN THE ExportButton SHALL silently suppress the error without rendering an error message or changing button appearance.
