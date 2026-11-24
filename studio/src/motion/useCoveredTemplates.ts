import { useEffect, useState } from 'react';
import type { GalleryTemplate, TemplatePage } from '../../../shared/catalog';
import { motionApi } from './useWorkspace';

export async function loadCoveredTemplates(
  locale: string,
  signal: AbortSignal,
  onFirstPage?: (page: TemplatePage) => void,
  { covered = true } = {},
) {
  const items = new Map<string, GalleryTemplate>();
  let offset = 0;
  while (true) {
    const query = new URLSearchParams({ category: 'all', limit: '60', offset: String(offset), locale });
    if (covered) query.set('covered', 'true');
    const page = await motionApi<TemplatePage>(`/template-catalog?${query}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    });
    signal.throwIfAborted();
    if (!Array.isArray(page.items)) throw new Error('Invalid catalogue');
    for (const item of page.items) items.set(item.id, item);
    if (page.next == null) return { items: [...items.values()], catalogVersion: page.catalogVersion, warning: page.warning };
    if (offset === 0) onFirstPage?.(page);
    if (!Number.isSafeInteger(page.next) || page.next <= offset) throw new Error('Invalid catalogue cursor');
    offset = page.next;
  }
}

export function useCoveredTemplates(locale: string, enabled = true, { showFirstPage = false, covered = true } = {}) {
  const [loaded, setLoaded] = useState<{ locale: string; covered: boolean; items: GalleryTemplate[] } | null>(null);
  const catalog = loaded?.locale === locale && loaded.covered === covered ? loaded.items : null;
  const [first, setFirst] = useState<{ locale: string; covered: boolean; page: TemplatePage } | null>(null);
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || catalog) return;
    const controller = new AbortController();
    setFailed(false);
    void loadCoveredTemplates(locale, controller.signal, showFirstPage ? page => setFirst({ locale, covered, page }) : undefined, { covered }).then(result => {
      if (!controller.signal.aborted) setLoaded({ locale, covered, items: result.items });
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [locale, enabled, attempt, catalog, showFirstPage, covered]);
  return { catalog, firstPage: first?.locale === locale && first.covered === covered ? first.page : null, failed, retry: () => setAttempt(value => value + 1) };
}
