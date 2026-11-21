import { liveTime, usePlayerStore } from "../store/playerStore";

type TransportPosition = { time: number; playing: boolean };
const pending = new WeakMap<HTMLIFrameElement, TransportPosition>();

// Only an expired or replaced lease starts a new document in the same live iframe.
export function rememberPreviewPosition(frame: HTMLIFrameElement) {
  const player = usePlayerStore.getState();
  const time = player.isPlaying ? liveTime.latest() : player.currentTime;
  pending.set(frame, { time, playing: player.isPlaying });
  if (player.isPlaying) player.requestPlayback(false);
}

export function takePreviewPosition(frame: HTMLIFrameElement | null) {
  if (!frame) return;
  const saved = pending.get(frame);
  pending.delete(frame);
  return saved;
}
