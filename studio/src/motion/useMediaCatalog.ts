import { useCallback, useEffect, useRef, useState } from 'react';
import { invalidateGatewayCache, loadGateway } from './gatewayClient';
import { peekCachedGateway } from './gatewayCache';

/** Both navigation and generation read the executable gateway catalog. */
export function useMediaCatalog(active: boolean) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof loadGateway>> | undefined>(() =>
    active ? peekCachedGateway() : undefined,
  );
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  const retry = useCallback(() => {
    sequence.current++;
    invalidateGatewayCache();
    setCatalog(undefined);
    setFailed(false);
    setAttempt(value => value + 1);
  }, []);
  useEffect(() => {
    window.addEventListener('motion:gateway-changed', retry);
    return () => window.removeEventListener('motion:gateway-changed', retry);
  }, [retry]);
  useEffect(() => {
    setFailed(false);
    if (!active) {
      setCatalog(undefined);
      return;
    }
    const cached = attempt === 0 ? peekCachedGateway() : undefined;
    if (cached) {
      setCatalog(cached);
    } else {
      setCatalog(undefined);
    }
    const request = ++sequence.current;
    void loadGateway()
      .then(value => { if (sequence.current === request) setCatalog(value); })
      .catch(() => {
        if (sequence.current === request && !cached) setFailed(true);
      });
    return () => { sequence.current++; };
  }, [active, attempt]);
  return { catalog, failed, retry };
}
