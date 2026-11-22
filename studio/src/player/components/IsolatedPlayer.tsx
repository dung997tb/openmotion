import { InitialPreviewLeaseContext } from "../../motion/StudioHost";
import { forwardRef, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "open-design-ui/button";
import { useI18n } from "../../i18n/I18n";
import { applyPreviewVariablesToUrl } from "../../hooks/previewVariablesStore";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { createPreviewAdapter } from "../lib/previewAdapter";
import { bindPreviewLease } from "../lib/previewLease";
import { rememberPreviewPosition } from "../lib/previewReconnect";
import { announcePreviewDocumentLoaded } from "../sceneSwap";
import { usePlayerStore } from "../store/playerStore";
import { PreviewCompositionLoading } from "./PreviewCompositionLoading";
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
    const prepared = useContext(InitialPreviewLeaseContext);
    const initialLease = useRef(props.showInitialLoading ? prepared : undefined);
    const passive = props.passive === true;
    const lease = useRef<ReturnType<typeof bindPreviewLease> | null>(null);
    const busyRetries = useRef(0);
    const [error, setError] = useState<string>();
    const [awaitingFirstFrame, setAwaitingFirstFrame] = useState(props.showInitialLoading === true);
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
      let runtimeTime: number | undefined;
      let bridge: ReturnType<typeof createPreviewAdapter> | undefined;
      let loadId = 0;
      let startedAt = performance.now();
      let deadline: ReturnType<typeof setTimeout>;
      let paintFrame = 0;
      let busyTimer: ReturnType<typeof setTimeout>;
      let busyForLoad = false;
      busyRetries.current = 0;
      function resize() {
        const [width, height] = size;
        const scale = Math.min(stage!.clientWidth / width, stage!.clientHeight / height);
        Object.assign(iframe!.style, {
          width: width + "px", height: height + "px",
          transform: `translate(-50%, -50%) scale(${scale})`,
        });
      }
      function fail(message: string) {
        clearTimeout(busyTimer);
        clearTimeout(deadline);
        setError(message);
        callbacks.current.onCompositionLoadingChange?.(false);
        callbacks.current.onPreviewError?.(message);
        if (!passive) usePlayerStore.getState().markPreviewBooted();
      }
      function message(event: MessageEvent) {
        if (!bridge?.accepts(event)) return;
        if (event.data.type === "preview-build-busy") {
          if (ready || busyForLoad) return;
          busyForLoad = true;
          if (busyRetries.current >= 3) {
            fail("Preview builders are busy. Try again shortly.");
            return;
          }
          const baseline = Math.min(5000, Math.max(1000, Number(event.data.retryAfterMs) || 1000));
          const delay = baseline * 2 ** busyRetries.current * (1 + Math.random());
          busyRetries.current++;
          busyTimer = setTimeout(() => void lease.current?.retry(), delay);
          return;
        }
        if (event.data.type !== "timeline-state") return;
        if (Number.isFinite(event.data.currentTime)) runtimeTime = event.data.currentTime;
        if (ready || !(event.data.duration > 0)) return;
        ready = true;
        busyRetries.current = 0;
        clearTimeout(busyTimer);
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
          setAwaitingFirstFrame(false);
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
        if (ready && !passive && !callbacks.current.noLoadTimeout) rememberPreviewPosition(iframe, runtimeTime);
        ready = false;
        busyForLoad = false;
        clearTimeout(busyTimer);
        setError(undefined);
        clearTimeout(deadline);
        cancelAnimationFrame(paintFrame);
        startedAt = performance.now();
        loadId++;
        callbacks.current.onReadyToShowChange?.(false);
        callbacks.current.onCompositionLoadingChange?.(true);
        runtimeTime = undefined;
        iframe.src = next.href;
        bridge = createPreviewAdapter({ iframe, expectedOrigin: props.origin });
        deadline = setTimeout(() => fail("The composition preview did not become ready."), 15_000);
      }, fail, initialLease.current);
      return () => {
        clearTimeout(busyTimer);
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
        {awaitingFirstFrame && !error && !passive && props.loadingUi !== "host" && <PreviewCompositionLoading />}
        {error && !passive && <div data-testid="composition-preview-error" className="absolute inset-0 flex flex-col items-center justify-center bg-studio-surface text-center">
          <p>{t(error)}</p>
          <Button variant="plain" onClick={() => {
            busyRetries.current = 0;
            setError(undefined);
            setAwaitingFirstFrame(props.showInitialLoading === true);
            void lease.current?.retry();
          }}>{t("Retry preview")}</Button>
        </div>}
      </div>
    );
  },
);
