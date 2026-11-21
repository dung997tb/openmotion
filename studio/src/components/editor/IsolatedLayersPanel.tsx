import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18n";
import { trackStudioClick } from "../../motion/editorTracking";
import { createPreviewAdapter, type PreviewAdapter } from "../../player/lib/previewAdapter";
import { isolatedPreviewOrigin } from "../../player/lib/previewLease";
import { onPreviewContentReplaced } from "../../player/sceneSwap";
import { PanelEmptyState } from "../ui/PanelEmptyState";
import { LayerRow } from "./LayerRow";
import { isPreviewLayerList, type PreviewLayer } from "../../../../shared/preview-layer";
import { getVisibleLayers, sortLayerRows } from "./layersPanelSort";

export function IsolatedLayersPanel({ iframe }: { iframe: HTMLIFrameElement | null }) {
  const { t } = useI18n();
  const [layers, setLayers] = useState<PreviewLayer[] | "loading" | "unavailable">("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const connection = useRef<{ adapter: PreviewAdapter; subscription: string } | null>(null);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    function subscribe() {
      clearTimeout(timeout);
      setSelected(null);
      setLayers("loading");
      setCollapsed({});
      if (!iframe) return;
      const adapter = createPreviewAdapter({ iframe });
      if (!adapter.token || !adapter.projectId || adapter.targetOrigin !== isolatedPreviewOrigin()) return;
      const subscription = crypto.randomUUID();
      connection.current = { adapter, subscription };
      adapter.send("layer-tree", { subscription });
      timeout = setTimeout(() => setLayers("unavailable"), 3000);
    }
    function receive(event: MessageEvent) {
      const type = event.data?.type;
      if (!iframe || (type !== "layer-tree" && type !== "select-element" && type !== "preview-ready")) return;
      const adapter = createPreviewAdapter({ iframe });
      if (adapter.targetOrigin !== isolatedPreviewOrigin() || !adapter.accepts(event)) return;
      const { subscription, rows, layerKey } = event.data;
      if (type === "preview-ready") { subscribe(); return; }
      if (subscription !== connection.current?.subscription) return;
      if (type === "layer-tree" && isPreviewLayerList(rows)) {
        clearTimeout(timeout);
        setLayers(sortLayerRows(rows, row => row.z));
      }
      if (type === "select-element" && typeof layerKey === "string") setSelected(layerKey);
    }
    window.addEventListener("message", receive);
    const unsubscribe = iframe && onPreviewContentReplaced(iframe, subscribe);
    subscribe();
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      unsubscribe?.();
      const active = connection.current;
      active?.adapter.send("layer-tree", { close: true, subscription: active.subscription });
      connection.current = null;
    };
  }, [iframe]);

  if (layers === "loading" || layers === "unavailable") return <PanelEmptyState icon="stack-line"
    message={t(layers === "loading" ? "Loading preview…" : "Preview unavailable")} />;
  if (!layers.length) return <PanelEmptyState icon="stack-line" message={t("No layers")} />;
  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-bg">
    <div className="relative min-h-0 flex-1 select-none overflow-y-auto py-1">
      {getVisibleLayers(layers, collapsed).map((layer, index) => <LayerRow key={layer.key}
        label={layer.label} depth={layer.depth} childCount={layer.childCount} kind={layer.kind} isCompHost={layer.isCompHost} index={index} selected={selected === layer.key} isCollapsed={Boolean(collapsed[layer.key])}
        onToggle={() => setCollapsed(current => ({ ...current, [layer.key]: !current[layer.key] }))}
        onSelect={() => {
          const active = connection.current;
          if (!active || active.adapter.iframe !== iframe) return;
          active.adapter.send("layer-select", { key: layer.key, subscription: active.subscription });
          trackStudioClick("layers", "locate_layer");
        }}
      />)}
    </div>
  </div>;
}
