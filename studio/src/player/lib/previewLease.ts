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
  let expiresAt = 0;
  let navigateOnGrant = false;
  let retryDelay = 1000;

  // Active editors recover within a second. Suspended background viewers can spread over a longer window.
  const recoveryDelay = () => Math.random() * (document.hidden ? 30_000 : 1000);

  function schedule(delay: number, spreadIfSuspended = false) {
    renewAt = Date.now() + delay;
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Timers that were originally staggered can all run together after system sleep.
      const now = Date.now();
      if (spreadIfSuspended && now >= expiresAt && now - renewAt > 1000) schedule(recoveryDelay());
      else void renew();
    }, delay);
  }

  async function renew() {
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
      const deadline = Date.parse(grant.expiresAt);
      const ttl = deadline - Date.now();
      if (grant.previewOrigin !== origin || typeof grant.token !== "string" || !grant.token ||
          typeof grant.assetLease !== "string" || !grant.assetLease || !(ttl > 0)) {
        throw new Error("Invalid preview authorization");
      }
      if (controller.signal.aborted) return;
      if (navigateOnGrant || assetLease !== grant.assetLease) {
        const url = new URL(source.pathname, origin);
        url.search = source.search;
        url.searchParams.set("pt", grant.token);
        navigate(url);
      }
      assetLease = grant.assetLease;
      expiresAt = deadline;
      navigateOnGrant = false;
      retryDelay = 1000;
      // Keep at least one renewal window before expiry, and spread simultaneous viewers over another.
      const windowMs = Math.min(30_000, ttl / 5);
      schedule(ttl - windowMs * (1 + Math.random()), true);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!assetLease) failed(error instanceof Error ? error.message : "Preview authorization failed");
      schedule(retryDelay * (0.5 + Math.random() / 2));
      retryDelay = Math.min(30_000, retryDelay * 2);
    } finally {
      pending = false;
    }
  }

  const wake = () => {
    if (document.hidden || pending || renewAt === Infinity) return;
    const now = Date.now();
    if (now < renewAt && now < expiresAt) return;
    // A reconnect may pull an expired lease out of a long backoff. Repeated
    // online/visibility events must not postpone a recovery already due shortly.
    if (renewAt > now && renewAt - now <= 1000) return;
    schedule(recoveryDelay());
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  void renew();
  return {
    retry() {
      navigateOnGrant = true;
      return renew();
    },
    dispose() {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    },
  };
}
