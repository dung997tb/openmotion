import { useI18n } from "../../i18n/I18n";
import { Skeleton } from "../ui/Skeleton";

export function FileListLoading() {
  const { t } = useI18n();
  return <div role="status" aria-label={t("Loading…")} className="space-y-2 p-2">
    {[0, 1, 2].map(row => <div key={row} className="flex items-center gap-2">
      <Skeleton className="h-10 w-16 shrink-0" />
      <Skeleton className="h-3 w-1/3" />
    </div>)}
  </div>;
}
