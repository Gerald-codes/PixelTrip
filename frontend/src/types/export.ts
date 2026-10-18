/**
 * Export (WRAP) shape.
 *
 * Mirrors the "Export (WRAP)" contract in `api-contracts.md`. The concrete
 * shareable payload shape is backend-defined, so `shareable` is typed as
 * `unknown` (never `any`).
 */
export interface ExportPayload {
  tripId: string;
  shareable: unknown;
}
