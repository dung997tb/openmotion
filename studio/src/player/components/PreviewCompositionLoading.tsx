import { useI18n } from "../../i18n/I18n";
import { HyperframesLoader } from "../../components/ui";

export function PreviewCompositionLoading() {
  const { t } = useI18n();
  return (
    <div
      className="absolute inset-0 z-30 flex select-none items-center justify-center bg-black/80"
      data-hyperframes-ignore=""
      data-testid="composition-loading-overlay"
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={(event) => event.preventDefault()}
    >
      <HyperframesLoader title={t("Loading composition")} size={56} />
    </div>
  );
}
