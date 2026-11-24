/**
 * Props for StudioRightPanels.
 *
 * Kept beside the component rather than inside it: the panel is at the file-size
 * cap, and this block is the part that changes least, so moving it keeps the
 * component's own diffs small and readable.
 */

import type { StudioEditPersistenceProps } from "./panels/VariablesPanel";
import type { BlockParam } from "@hyperframes/core/registry";
import type { Composition } from "@hyperframes/sdk";
import type { UseSlideshowPersistParams } from "../hooks/useSlideshowPersist";
import type { AddMediaOverlayHandler } from "./editor/propertyPanelTypes";
import type { ToggleHiddenHandler } from "../utils/studioHelpers";

export interface StudioRightPanelsProps extends StudioEditPersistenceProps {
  activeBlockParams?: {
    blockName: string;
    blockTitle: string;
    params: BlockParam[];
    compositionPath: string;
  } | null;
  onCloseBlockParams?: () => void;
  /** Drops the block-params view without touching the dock (selection or leaving Design). */
  onDismissBlockParams: () => void;
  recordingState?: "idle" | "recording" | "preview";
  recordingDuration?: number;
  onToggleRecording?: () => void;
  /** Dependencies for the Slideshow persist callback, threaded from App.tsx. */
  sdkSourcePath: string | null;
  sdkSession: Composition | null;
  publishSdkSession: NonNullable<UseSlideshowPersistParams["publishSdkSession"]>;
  /** Refresh the active composition after a variable edit through a separate source-file session. */
  forceReloadSdkSession?: () => void;
  reloadPreview: () => void;
  recordEdit: (entry: {
    label: string;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
  onToggleElementHidden?: ToggleHiddenHandler;
  onAutoGroupCarveSources?: (clipIds: readonly string[], groupId: string) => Promise<void>;
  onAddMediaOverlay?: AddMediaOverlayHandler;
}
