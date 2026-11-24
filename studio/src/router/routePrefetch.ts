import { prefetchDesignScene } from '../design/designClient';
import { prefetchAssetHistory, prefetchAssetList } from '../motion/assetClient';
import { prefetchGateway } from '../motion/gatewayClient';
import { prefetchIntegrationInfo } from '../motion/useIntegrationInfo';
import { prefetchScenarioHub } from '../scenario/scenarioClient';
import { prefetchSuperAgentWorkspace } from '../super-agent/superAgentClient';
import { isClientCacheEnabled } from '../utils/clientCacheMode';
import { preloadStudioRoute, preloadWorkspacePage, type LazyPageKey } from './lazyPages';

function shouldSkipPrefetch(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData);
}

/** Preloads both the route JS chunk and initial data required for a top-bar studio/surface. */
export function prefetchStudioTarget(target: string): void {
  preloadStudioRoute(target);
  if (!isClientCacheEnabled() || shouldSkipPrefetch()) return;

  if (target === 'image') {
    prefetchGateway();
    prefetchAssetList({ modality: 'image', source: 'generated', sort: 'newest', offset: 0, limit: 40 });
    prefetchAssetHistory();
    return;
  }
  if (target === 'video') {
    prefetchGateway();
    prefetchAssetList({ modality: 'video', source: 'generated', sort: 'newest', offset: 0, limit: 40 });
    prefetchAssetHistory();
    return;
  }
  if (target === 'audio') {
    prefetchGateway();
    prefetchAssetList({ modality: 'audio', sort: 'newest', offset: 0, limit: 40 });
    prefetchAssetHistory();
    return;
  }
  if (target === 'workflows') {
    prefetchScenarioHub();
    return;
  }
  if (target === 'mcp') {
    prefetchIntegrationInfo();
    return;
  }
  if (target === 'agent' || target === 'game') {
    prefetchSuperAgentWorkspace();
    return;
  }
  if (target === 'design') {
    prefetchDesignScene('prototype');
    prefetchIntegrationInfo();
    return;
  }
  if (target === 'explore' || target === 'motion' || target === 'cinema') {
    prefetchGateway();
    return;
  }
  if (target === 'assets') {
    prefetchAssetList({ sort: 'newest', offset: 0, limit: 40 });
    prefetchAssetHistory();
  }
}

const IDLE_WARMUP_CHUNKS: readonly LazyPageKey[] = [
  'creative',
  'agent',
  'scenarioHub',
  'design',
  'mcp',
  'motion',
  'cinema',
  'explore',
];

/** Staggered post-LCP idle warmer that primes route chunks and core metadata one step per idle slice. */
export function scheduleIdleRouteWarmup(): () => void {
  if (typeof window === 'undefined' || !isClientCacheEnabled() || shouldSkipPrefetch()) {
    return () => {};
  }

  let cancelled = false;
  let initialTimer: number | undefined;
  let stepTimeout: number | undefined;
  let stepIdle: number | undefined;

  const tasks: Array<() => void> = [
    ...IDLE_WARMUP_CHUNKS.map(key => () => preloadWorkspacePage(key)),
    () => prefetchGateway(),
    () => prefetchIntegrationInfo(),
  ];

  let index = 0;
  const runNext = () => {
    if (cancelled || index >= tasks.length) return;
    tasks[index++]();
    if (index < tasks.length) scheduleStep();
  };

  const scheduleStep = () => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === 'function') {
      stepIdle = window.requestIdleCallback(() => {
        stepIdle = undefined;
        runNext();
      }, { timeout: 1500 });
    } else {
      stepTimeout = window.setTimeout(() => {
        stepTimeout = undefined;
        runNext();
      }, 250);
    }
  };

  initialTimer = window.setTimeout(() => {
    initialTimer = undefined;
    scheduleStep();
  }, 1000);

  return () => {
    cancelled = true;
    if (initialTimer !== undefined) window.clearTimeout(initialTimer);
    if (stepTimeout !== undefined) window.clearTimeout(stepTimeout);
    if (stepIdle !== undefined && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(stepIdle);
    }
  };
}
