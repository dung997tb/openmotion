export const TIMING_ATTRIBUTES = [
  "data-start", "data-end", "data-duration", "data-track-index", "data-playback-start", "data-media-start",
] as const;

export interface PreviewTimingChange {
  hfId: string | null;
  id: string;
  compositionId: string | null;
  tag: string;
  attributes: [typeof TIMING_ATTRIBUTES[number], string | null, string | null][];
}
