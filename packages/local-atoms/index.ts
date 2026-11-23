/**
 * Shared Five Atomic Local Capabilities Engine (K7 + K4).
 *
 * Host-agnostic runtime consumed identically by:
 * - Electron thin desktop shell (`CapabilityRegistry`, K6)
 * - Web Connect Script loopback host (K9)
 */

import type { BuiltinPublisherEntry } from '../../shared/desktop-builtin-rules.ts';
import {
  HOST_CAPABILITIES,
  HOST_CAPABILITY_VERSIONS,
  hostErr,
  type AtomConfigReadParams,
  type AtomConfigWriteParams,
  type AtomCredentialStartParams,
  type AtomExecParams,
  type AtomInstallComponentParams,
  type HostCapabilityDescriptor,
  type HostInvokeResult,
  type HostPlatform,
  type HostReleaseChannel,
} from '../../shared/desktop-contract.ts';
import type { SignedConfigPayload } from '../../shared/signed-config.ts';
import {
  ConfigAtom,
  createConfigAtom,
  type AtomConfigRestoreParams,
} from './config.ts';
import {
  FeatureConfirmationGate,
  createFeatureConfirmationGate,
  type ConfirmCallback,
} from './confirmation.ts';
import {
  CredentialAtom,
  createCredentialAtom,
  type AtomCredentialInjectParams,
  type AtomCredentialPollParams,
  type AtomCredentialRevokeParams,
  type CredentialHttpClient,
  type SecretStore,
} from './credential.ts';
import {
  DetectAtom,
  createDetectAtom,
  type AtomDetectParams,
  type EngineHttpProbe,
} from './detect.ts';
import {
  ExecAtom,
  createExecAtom,
  type CommandRunner,
} from './exec.ts';
import {
  ComponentInstallRegistry,
  InstallComponentAtom,
  createInstallComponentAtom,
  type ArtifactDownloader,
  type CodeSignatureVerifier,
} from './install-component.ts';
import {
  PathResolver,
  createPathResolver,
  type LoginShellRunner,
  type PathResolverFs,
} from './path-resolver.ts';
import { SerialMutationQueue, createSerialMutationQueue } from './serial-queue.ts';

export * from './path-resolver.ts';
export * from './serial-queue.ts';
export * from './confirmation.ts';
export * from './config.ts';
export * from './install-component.ts';
export * from './exec.ts';
export * from './credential.ts';
export * from './detect.ts';

export type LocalAtomCapabilityName =
  | typeof HOST_CAPABILITIES.ATOM_DETECT
  | typeof HOST_CAPABILITIES.ATOM_EXEC
  | typeof HOST_CAPABILITIES.ATOM_INSTALL_COMPONENT
  | typeof HOST_CAPABILITIES.ATOM_CREDENTIAL
  | typeof HOST_CAPABILITIES.ATOM_CONFIG;

export type LocalAtomCapabilityHandler = {
  descriptor: HostCapabilityDescriptor;
  invoke: (method: string, params?: Record<string, unknown>) => Promise<HostInvokeResult>;
};

export type LocalAtomsRuntimeDeps = {
  dataDir: string;
  homeDir?: string;
  platform?: HostPlatform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  channel?: HostReleaseChannel;
  allowLocalDevLoopback?: boolean;
  appBundlePath?: string;
  expectedMcpUrl?: string;
  getSignedConfig: () => SignedConfigPayload;
  confirmCallback: ConfirmCallback;
  /** Optional injectable dependencies for deterministic tests or custom host adapters. */
  pathResolver?: PathResolver;
  loginShellRunner?: LoginShellRunner;
  pathResolverFs?: Partial<PathResolverFs>;
  mutationQueue?: SerialMutationQueue;
  confirmationGate?: FeatureConfirmationGate;
  componentRegistry?: ComponentInstallRegistry;
  commandRunner?: CommandRunner;
  engineHttpProbe?: EngineHttpProbe;
  downloader?: ArtifactDownloader;
  codeSignatureVerifier?: CodeSignatureVerifier;
  publishers?: readonly BuiltinPublisherEntry[];
  secretStore?: SecretStore;
  credentialHttpClient?: CredentialHttpClient;
  now?: () => Date;
};

export type LocalAtomsRuntime = {
  capabilities: Record<LocalAtomCapabilityName, LocalAtomCapabilityHandler>;
  descriptors: () => HostCapabilityDescriptor[];
  invoke: (capability: string, method: string, params?: Record<string, unknown>) => Promise<HostInvokeResult>;
  pathResolver: PathResolver;
  mutationQueue: SerialMutationQueue;
  confirmationGate: FeatureConfirmationGate;
  componentRegistry: ComponentInstallRegistry;
  atoms: {
    detect: DetectAtom;
    exec: ExecAtom;
    installComponent: InstallComponentAtom;
    credential: CredentialAtom;
    config: ConfigAtom;
  };
};

export function createLocalAtomsRuntime(deps: LocalAtomsRuntimeDeps): LocalAtomsRuntime {
  const pathResolver =
    deps.pathResolver ??
    createPathResolver({
      platform: deps.platform,
      homeDir: deps.homeDir,
      env: deps.env,
      loginShellRunner: deps.loginShellRunner,
      fs: deps.pathResolverFs,
    });

  const mutationQueue = deps.mutationQueue ?? createSerialMutationQueue();
  const confirmationGate =
    deps.confirmationGate ??
    createFeatureConfirmationGate({
      dataDir: deps.dataDir,
      confirmCallback: deps.confirmCallback,
      now: deps.now,
    });
  const componentRegistry = deps.componentRegistry ?? new ComponentInstallRegistry(deps.dataDir);

  const isAllowedPublisherId = deps.publishers
    ? (publisherId: string) => deps.publishers!.some(entry => entry.id === publisherId)
    : undefined;

  const configAtom = createConfigAtom({
    dataDir: deps.dataDir,
    homeDir: deps.homeDir,
    channel: deps.channel,
    allowLocalDevLoopback: deps.allowLocalDevLoopback,
    getSignedConfig: deps.getSignedConfig,
    confirmationGate,
    mutationQueue,
    now: deps.now,
  });

  const installComponentAtom = createInstallComponentAtom({
    dataDir: deps.dataDir,
    platform: deps.platform,
    arch: deps.arch,
    channel: deps.channel,
    allowLocalDevLoopback: deps.allowLocalDevLoopback,
    appBundlePath: deps.appBundlePath,
    getSignedConfig: deps.getSignedConfig,
    confirmationGate,
    mutationQueue,
    registry: componentRegistry,
    publishers: deps.publishers,
    downloader: deps.downloader,
    codeSignatureVerifier: deps.codeSignatureVerifier,
    now: deps.now,
  });

  const execAtom = createExecAtom({
    homeDir: deps.homeDir,
    channel: deps.channel,
    allowLocalDevLoopback: deps.allowLocalDevLoopback,
    getSignedConfig: deps.getSignedConfig,
    pathResolver,
    componentRegistry,
    confirmationGate,
    mutationQueue,
    commandRunner: deps.commandRunner,
    isAllowedPublisherId,
  });

  const credentialAtom = createCredentialAtom({
    dataDir: deps.dataDir,
    platform: deps.platform,
    channel: deps.channel,
    allowLocalDevLoopback: deps.allowLocalDevLoopback,
    getSignedConfig: deps.getSignedConfig,
    confirmationGate,
    mutationQueue,
    execAtom,
    secretStore: deps.secretStore,
    httpClient: deps.credentialHttpClient,
    now: deps.now,
  });

  const detectAtom = createDetectAtom({
    platform: deps.platform,
    arch: deps.arch,
    homeDir: deps.homeDir,
    expectedMcpUrl: deps.expectedMcpUrl,
    getSignedConfig: deps.getSignedConfig,
    pathResolver,
    componentRegistry,
    commandRunner: deps.commandRunner,
    engineHttpProbe: deps.engineHttpProbe,
    now: deps.now,
  });

  const capabilities: Record<LocalAtomCapabilityName, LocalAtomCapabilityHandler> = {
    [HOST_CAPABILITIES.ATOM_DETECT]: {
      descriptor: {
        name: HOST_CAPABILITIES.ATOM_DETECT,
        version: HOST_CAPABILITY_VERSIONS[HOST_CAPABILITIES.ATOM_DETECT],
        status: 'available',
        methods: ['scan'],
      },
      async invoke(method, params) {
        if (method === 'scan' || method === 'detect') {
          return detectAtom.scan((params ?? {}) as AtomDetectParams);
        }
        return hostErr('UNSUPPORTED', `Unknown method "${method}" for ${HOST_CAPABILITIES.ATOM_DETECT}`);
      },
    },

    [HOST_CAPABILITIES.ATOM_EXEC]: {
      descriptor: {
        name: HOST_CAPABILITIES.ATOM_EXEC,
        version: HOST_CAPABILITY_VERSIONS[HOST_CAPABILITIES.ATOM_EXEC],
        status: 'available',
        methods: ['run', 'preview'],
      },
      async invoke(method, params) {
        if (method === 'run') {
          return execAtom.run((params ?? {}) as unknown as AtomExecParams);
        }
        if (method === 'preview') {
          return execAtom.preview((params ?? {}) as unknown as AtomExecParams);
        }
        return hostErr('UNSUPPORTED', `Unknown method "${method}" for ${HOST_CAPABILITIES.ATOM_EXEC}`);
      },
    },

    [HOST_CAPABILITIES.ATOM_INSTALL_COMPONENT]: {
      descriptor: {
        name: HOST_CAPABILITIES.ATOM_INSTALL_COMPONENT,
        version: HOST_CAPABILITY_VERSIONS[HOST_CAPABILITIES.ATOM_INSTALL_COMPONENT],
        status: 'available',
        methods: ['install', 'preview', 'status', 'uninstall'],
      },
      async invoke(method, params) {
        if (method === 'install') {
          return installComponentAtom.install((params ?? {}) as unknown as AtomInstallComponentParams);
        }
        if (method === 'preview') {
          return installComponentAtom.preview((params ?? {}) as unknown as AtomInstallComponentParams);
        }
        if (method === 'status') {
          return installComponentAtom.status((params ?? {}) as unknown as { componentId: string });
        }
        if (method === 'uninstall') {
          return installComponentAtom.uninstall((params ?? {}) as unknown as AtomInstallComponentParams);
        }
        return hostErr('UNSUPPORTED', `Unknown method "${method}" for ${HOST_CAPABILITIES.ATOM_INSTALL_COMPONENT}`);
      },
    },

    [HOST_CAPABILITIES.ATOM_CREDENTIAL]: {
      descriptor: {
        name: HOST_CAPABILITIES.ATOM_CREDENTIAL,
        version: HOST_CAPABILITY_VERSIONS[HOST_CAPABILITIES.ATOM_CREDENTIAL],
        status: 'available',
        methods: ['start', 'poll', 'status', 'inject', 'revoke'],
      },
      async invoke(method, params) {
        if (method === 'start') {
          return credentialAtom.start((params ?? {}) as unknown as AtomCredentialStartParams);
        }
        if (method === 'poll') {
          return credentialAtom.poll((params ?? {}) as unknown as AtomCredentialPollParams);
        }
        if (method === 'status') {
          return credentialAtom.status((params ?? {}) as unknown as { credentialId: string });
        }
        if (method === 'inject') {
          return credentialAtom.inject((params ?? {}) as unknown as AtomCredentialInjectParams);
        }
        if (method === 'revoke') {
          return credentialAtom.revoke((params ?? {}) as unknown as AtomCredentialRevokeParams);
        }
        return hostErr('UNSUPPORTED', `Unknown method "${method}" for ${HOST_CAPABILITIES.ATOM_CREDENTIAL}`);
      },
    },

    [HOST_CAPABILITIES.ATOM_CONFIG]: {
      descriptor: {
        name: HOST_CAPABILITIES.ATOM_CONFIG,
        version: HOST_CAPABILITY_VERSIONS[HOST_CAPABILITIES.ATOM_CONFIG],
        status: 'available',
        methods: ['read', 'write', 'previewWrite', 'restoreBackup'],
      },
      async invoke(method, params) {
        if (method === 'read') {
          return configAtom.read((params ?? {}) as unknown as AtomConfigReadParams);
        }
        if (method === 'write') {
          return configAtom.write((params ?? {}) as unknown as AtomConfigWriteParams);
        }
        if (method === 'previewWrite') {
          return configAtom.previewWrite((params ?? {}) as unknown as AtomConfigWriteParams);
        }
        if (method === 'restoreBackup') {
          return configAtom.restoreBackup((params ?? {}) as unknown as AtomConfigRestoreParams);
        }
        return hostErr('UNSUPPORTED', `Unknown method "${method}" for ${HOST_CAPABILITIES.ATOM_CONFIG}`);
      },
    },
  };

  return {
    capabilities,
    descriptors: () => Object.values(capabilities).map(entry => entry.descriptor),
    async invoke(capability, method, params) {
      const handler = capabilities[capability as LocalAtomCapabilityName];
      if (!handler) {
        return hostErr('UNSUPPORTED', `Unknown local atom capability: "${capability}"`);
      }
      return handler.invoke(method, params);
    },
    pathResolver,
    mutationQueue,
    confirmationGate,
    componentRegistry,
    atoms: {
      detect: detectAtom,
      exec: execAtom,
      installComponent: installComponentAtom,
      credential: credentialAtom,
      config: configAtom,
    },
  };
}
