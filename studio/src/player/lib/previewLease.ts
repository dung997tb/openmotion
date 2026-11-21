import { studioApiFetch } from "../../utils/studioApiFetch";

export function isolatedPreviewOrigin(): string | undefined {
  return typeof document === "undefined" ? undefined :
    document.querySelector<HTMLMetaElement>('meta[name="openmotion-preview-origin"]')?.content;
}

/** The host renews the asset lease. An uninterrupted lease keeps the current document alive. */
export function bindPreviewLease(
  source: URL,
  origin: string,
  navigate: (url: URL) => void,
  failed: (message: string) => void,
) {
  const project = /^\/api\/projects\/([^/]+)\/preview(?:\/|$)/.exec(source.pathname)?.[1];
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let pending = false;
  let assetLease: string | undefined;
  let renewAt = 0;
  let retryDelay = 1000;

  function schedule(delay: number) {
    renewAt = Date.now() + delay;
    timer = setTimeout(() => void renew(), delay);
  }

  async function renew(forceNavigation = false) {
    if (pending || controller.signal.aborted) return;
    clearTimeout(timer);
    pending = true;
    try {
      if (!project) throw new Error("Invalid project preview URL");
      const response = await studioApiFetch(`/api/projects/${project}/preview-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetLease: assetLease ?? true }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          assetLease = undefined;
          renewAt = Infinity;
          failed(`Preview access denied (HTTP ${response.status})`);
          return;
        }
        throw new Error(`Preview authorization failed (HTTP ${response.status})`);
      }
      const grant = await response.json();
      const ttl = Date.parse(grant.expiresAt) - Date.now();
      if (grant.previewOrigin !== origin || typeof grant.token !== "string" || !grant.token ||
          typeof grant.assetLease !== "string" || !grant.assetLease || !(ttl > 0)) {
        throw new Error("Invalid preview authorization");
      }
      if (controller.signal.aborted) return;
      if (forceNavigation || assetLease !== grant.assetLease) {
        const url = new URL(source.pathname, origin);
        url.search = source.search;
        url.searchParams.set("pt", grant.token);
        navigate(url);
      }
      assetLease = grant.assetLease;
      retryDelay = 1000;
      schedule(ttl - Math.min(30_000, ttl / 5));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!assetLease) failed(error instanceof Error ? error.message : "Preview authorization failed");
      schedule(retryDelay);
      retryDelay = Math.min(30_000, retryDelay * 2);
    } finally {
      pending = false;
    }
  }

  const wake = () => { if (!document.hidden && Date.now() >= renewAt) void renew(); };
  const reconnect = () => { if (renewAt !== Infinity) void renew(); };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", reconnect);
  void renew();
  return {
    retry: () => renew(true),
    dispose() {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", reconnect);
    },
  };
}
