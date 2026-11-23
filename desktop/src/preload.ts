import { contextBridge, ipcRenderer } from 'electron';
import type {
  HostCapabilityDescriptor,
  HostInvokeResult,
  HostRuntimeInfo,
  UniversalHostBridge,
} from '../../shared/desktop-contract.ts';
import { HOST_IPC_CHANNELS } from './ipc-guard.ts';

type HostEventEnvelope = {
  capability?: unknown;
  event?: unknown;
  payload?: unknown;
};

function isTopLevelFrame(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.top === window && window.self === window;
  } catch {
    return false;
  }
}

function isAllowedBridgeLocation(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  const protocol = window.location.protocol;
  if (protocol === 'https:') return true;
  if (protocol === 'http:') {
    const hostname = window.location.hostname.toLowerCase();
    return hostname === '127.0.0.1' || hostname === 'localhost';
  }
  return false;
}

if (isTopLevelFrame() && isAllowedBridgeLocation()) {
  const bridge: UniversalHostBridge = {
    info: () => ipcRenderer.invoke(HOST_IPC_CHANNELS.INFO) as Promise<HostRuntimeInfo>,
    capabilities: () =>
      ipcRenderer.invoke(HOST_IPC_CHANNELS.CAPABILITIES) as Promise<HostCapabilityDescriptor[]>,
    invoke: <T = unknown>(
      capability: string,
      method: string,
      params?: Record<string, unknown>,
    ): Promise<HostInvokeResult<T>> =>
      ipcRenderer.invoke(HOST_IPC_CHANNELS.INVOKE, {
        capability,
        method,
        params,
      }) as Promise<HostInvokeResult<T>>,
    subscribe: (capability, event, callback) => {
      if (
        typeof capability !== 'string' ||
        !capability ||
        typeof event !== 'string' ||
        !event ||
        typeof callback !== 'function'
      ) {
        return () => {};
      }
      const handler = (_ipcEvent: unknown, message: unknown) => {
        if (!message || typeof message !== 'object') return;
        const envelope = message as HostEventEnvelope;
        if (envelope.capability === capability && envelope.event === event) {
          callback(envelope.payload);
        }
      };
      ipcRenderer.on(HOST_IPC_CHANNELS.EVENT, handler);
      return () => {
        ipcRenderer.removeListener(HOST_IPC_CHANNELS.EVENT, handler);
      };
    },
  };

  contextBridge.exposeInMainWorld('__OPENMOTION_HOST__', bridge);

  if (typeof document !== 'undefined') {
    window.addEventListener('fullscreenchange', () => {
      ipcRenderer.send(HOST_IPC_CHANNELS.DOM_FULLSCREEN, Boolean(document.fullscreenElement));
    });
  }
}
