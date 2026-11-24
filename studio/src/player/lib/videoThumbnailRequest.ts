import { createThumbnailKey, type ThumbnailPriority } from "./thumbnailScheduler";
import { decodeVideoThumbnail } from "./thumbnailVideoDecoder";

export function createVideoThumbnailRequest(
  props: {
    videoSrc: string;
    sourceStart?: number;
    sourceRangeDuration?: number;
    duration: number;
    projectId: string;
    sessionEpoch: number;
    priority: ThumbnailPriority;
  },
  frameCount: number,
  rich: boolean,
) {
  const {
    videoSrc,
    sourceStart,
    sourceRangeDuration,
    duration,
    projectId,
    sessionEpoch,
    priority,
  } = props;
  return {
    key: createThumbnailKey({
      kind: "video",
      source: videoSrc,
      start: sourceStart,
      duration: sourceRangeDuration ?? duration,
      frames: frameCount,
    }),
    projectId,
    sessionEpoch,
    kind: "video" as const,
    priority,
    rich,
    load: (signal: AbortSignal) =>
      decodeVideoThumbnail(
        {
          source: videoSrc,
          contentVersion: createThumbnailKey({ project: projectId, session: sessionEpoch }),
          sourceStart,
          sourceRangeDuration: sourceRangeDuration ?? duration,
          frameCount,
          fit: "cover",
        },
        signal,
      ),
  };
}
