export const TIMING_ATTRIBUTES = [
  "data-start", "data-end", "data-duration", "data-track-index", "data-playback-start", "data-media-start",
] as const;

// Properties set directly by the inspector or by the positioning gesture.
export const PRESENTATION_STYLES = ["left", "top", "width", "height", "font-size", "font-weight", "text-align", "color", "background-color", "opacity"] as const;
export const PRESENTATION_TAGS = ["div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6"] as const;
export const MAX_PREVIEW_TEXT_LENGTH = 4096;

export interface PreviewChange {
  hfId: string | null;
  id: string;
  compositionId: string | null;
  tag: string;
  styles?: [typeof PRESENTATION_STYLES[number], string, string][];
  text?: [string, string];
  attributes: [typeof TIMING_ATTRIBUTES[number], string | null, string | null][];
}
