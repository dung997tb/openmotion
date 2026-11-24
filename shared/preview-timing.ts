export const MAX_PEER_PREVIEW_SOURCE_LENGTH = 128 * 1024;
export type PreviewLiveEdits = { position?: true; mediaTiming?: true };
export const TIMING_ATTRIBUTES = [
  "data-start", "data-end", "data-duration", "data-track-index", "data-playback-start", "data-media-start",
] as const;

// Properties set directly by the inspector or by the positioning gesture.
export const PRESENTATION_STYLES = ["position", "left", "top", "width", "height", "font-size", "font-weight", "text-align", "color", "background-color", "opacity"] as const;
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

/** Used by Studio and the isolated bridge to validate the complete set of changes. */
export function isLivePositionEdit(changes: PreviewChange[]): boolean {
  return Array.isArray(changes) && changes.length > 0 && changes.every(change =>
    !change?.text && Array.isArray(change?.attributes) && change.attributes.length === 0 &&
    Array.isArray(change.styles) && change.styles.length > 0 && change.styles.every(style =>
      Array.isArray(style) && style.length === 3 && (style[0] === "left" || style[0] === "top") &&
      style.slice(1).every(value => typeof value === "string" && (value === "" || /^-?(?:\d+\.?\d*|\.\d+)px$/.test(value)))));
}
