import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "open-design-ui/button";
import { useI18n } from "../../i18n/I18n";
import { applyPreviewVariablesToUrl } from "../../hooks/previewVariablesStore";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { createPreviewAdapter } from "../lib/previewAdapter";
import { bindPreviewLease } from "../lib/previewLease";
import { rememberPreviewPosition } from "../lib/previewReconnect";
import { announcePreviewDocumentLoaded } from "../sceneSwap";
import { usePlayerStore } from "../store/playerStore";
import type { PlayerProps } from "./Player";

/** The remote runtime owns the document. Studio can size the frame and use its scoped message channel. */
export const IsolatedPlayer = forwardRef<HTMLIFrameElement, PlayerProps & { origin: string; passive?: boolean }>(
  function IsolatedPlayer(props, forwardedRef) {
    const { t } = useI18n();
    const container = useRef<HTMLDivElement>(null);
    const frame = useRef<HTMLIFrameElement>(null);
    const callbacks = useRef(props);
    callbacks.current = props;
    // Shadow promotion changes props and the forwarded ref without replacing the live document.
    const source = useRef(props.directUrl ?? (props.projectId && buildProjectApiPath(props.projectId, "/preview")));
    const initialPortrait = useRef(props.portrait);
    const passive = props.passive === true;
    const lease = useRef<ReturnType<typeof bindPreviewLease> | null>(null);
    const [error, setError] = useState<string>();
    const attach = useCallback((node: HTMLIFrameElement | null) => {
      frame.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }, [forwardedRef]);

    useEffect(() => {
      const iframe = frame.current;
      const stage = container.current;
      if (!iframe || !stage || !source.current) return;
      const url = new URL(source.current, window.location.origin);
      applyPreviewVariablesToUrl(url);
      let size = initialPortrait.current ? [1080, 1920] : [1920, 1080];
      let ready = false;
      let loadId = 0;
      let startedAt = performance.now();
      let deadline: ReturnType<typeof setTimeout>;
      let paintFrame = 0;
      function resize() {
        const [width, height] = size;
        const scale = Math.min(stage!.clientWidth / width, stage!.clientHeight / height);
        Object.assign(iframe!.style, {
          width: width + "px", height: height + "px",
          transform: `translate(-50%, -50%) scale(${scale})`,
        });
      }
      function fail(message: string) {
        setError(message);
        callbacks.current.onCompositionLoadingChange?.(false);
        callbacks.current.onPreviewError?.(message);
        if (!passive) usePlayerStore.getState().markPreviewBooted();
      }
      function message(event: MessageEvent) {
        if (ready || event.data?.type !== "timeline-state" || !(event.data.duration > 0)) return;
        const adapter = createPreviewAdapter({ iframe: iframe!, expectedOrigin: props.origin });
        if (!adapter.accepts(event)) return;
        ready = true;
        setError(undefined);
        clearTimeout(deadline);
        const { width, height } = event.data;
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width <= 16384 && height <= 16384) {
          size = [width, height];
          iframe!.width = String(width);
          iframe!.height = String(height);
        }
        resize();
        callbacks.current.onLoad();
        if (!passive) announcePreviewDocumentLoaded(iframe!);
        paintFrame = requestAnimationFrame(() => {
          callbacks.current.onCompositionLoadingChange?.(false);
          callbacks.current.onPainted?.({ iframe: iframe!, startedAt, loadId });
          callbacks.current.onReadyToShowChange?.(true);
          if (!passive) usePlayerStore.getState().markPreviewBooted();
        });
      }
      const observer = new ResizeObserver(resize);
      observer.observe(stage);
      window.addEventListener("message", message);
      lease.current = bindPreviewLease(url, props.origin, (next) => {
        if (ready && !passive && !callbacks.current.noLoadTimeout) rememberPreviewPosition(iframe);
        ready = false;
        setError(undefined);
        clearTimeout(deadline);
        cancelAnimationFrame(paintFrame);
        startedAt = performance.now();
        loadId++;
        callbacks.current.onReadyToShowChange?.(false);
        callbacks.current.onCompositionLoadingChange?.(true);
        iframe.src = next.href;
        deadline = setTimeout(() => fail("The composition preview did not become ready."), 15_000);
      }, fail);
      return () => {
        clearTimeout(deadline);
        cancelAnimationFrame(paintFrame);
        observer.disconnect();
        window.removeEventListener("message", message);
        lease.current?.dispose();
      };
    }, [props.origin, passive]);

    return (
      <div className="relative h-full w-full overflow-hidden" style={props.style} ref={container}>
        <iframe ref={attach} title={t("Composition preview")} sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer" tabIndex={passive ? -1 : undefined}
          allow={passive ? "autoplay 'none'" : "autoplay; fullscreen"}
          className="absolute left-1/2 top-1/2 max-w-none border-0" />
        {error && !passive && <div data-testid="composition-preview-error" className="absolute inset-0 flex flex-col items-center justify-center bg-studio-surface text-center">
          <p>{error}</p>
          <Button variant="plain" onClick={() => void lease.current?.retry()}>{t("Retry preview")}</Button>
        </div>}
      </div>
    );
  },
);
