import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRuntimeInfo } from '../../../shared/agent-runtimes';
import { isDesignScenario } from '../../../shared/design-project';
import type { GameCard } from '../../../shared/game-contract';
import type { GatewayStatus, Model } from '../../../shared/gateway';
import type { LocalAgent } from '../../../shared/local-agents';
import {
  modeToSuperAgentIntent,
  superAgentIntentMeta,
  type SuperAgentArtifact,
  type SuperAgentChat,
  type SuperAgentContextTag,
  type SuperAgentDesignModuleId,
  type SuperAgentEngine,
  type SuperAgentFileOperation,
  type SuperAgentFollowUpMode,
  type SuperAgentMessage,
  type SuperAgentPermissionMode,
  type SuperAgentQueuedMessage,
  type SuperAgentResourceAttachment,
  type SuperAgentResourceCounts,
} from '../../../shared/super-agent';
import { assetMediaUrl, assetVersion } from '../../../shared/asset-library';
import { OpenDesignLoadingMark } from '../components/ui/OpenDesignLoadingMark';
import { Popover } from '../components/ui/Popover';
import { Select } from '../components/ui/Select';
import { Skeleton } from '../components/ui/Skeleton';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { uploadLibraryAsset } from '../motion/assetClient';
import {
  communityRemixPrompt,
  composeBrief,
  gameApi,
  rememberInstruction,
} from '../motion/game/gameCatalog';
import {
  buildGameContextTags,
  buildGameHiddenInstructions,
  buildGameUserPrompt,
  localizedGameTitle,
  toGameArtifact,
  toGameResourceAttachment,
} from '../motion/game/gameSuperAgent';
import { gatewayRequest } from '../motion/gatewayClient';
import { ModelAvatar, ProviderAvatar } from '../motion/settingsPrimitives';
import { inspectBridgeAgent, notifyRuntimesChanged } from '../motion/useAgentRuntimes';
import { notifyAgentsChanged } from '../motion/useLocalAgents';
import { WorkspaceBack } from '../motion/WorkspaceBack';
import { compactDirLabel } from './ChangedFilesTree';
import { ApprovalCard, ExecutionTimeline } from './ExecutionTimeline';
import { ResourcePickerPanel, resourceIcon, resourceKey, type ResourceCategoryTab } from './ResourcePickerDialog';
import {
  findSuperAgentMode,
  ModeResourceShowcase,
  type SuperAgentCreationModeId,
} from './ModeResourceShowcase';
import {
  buildModeContextTags,
  buildModeHiddenDirective,
  DEFAULT_MODE_COMPOSER_OPTIONS,
  designScenarioOptionsPatch,
  formatModePromptPrefix,
  getModeComposerPlaceholder,
  ModeComposerControls,
  ModeComposerTopBar,
  isPlayableAd,
  type ModeComposerOptions,
} from './ModeComposerControls';

export function resolveCreationModeEntry(
  mode: SuperAgentCreationModeId | null,
  designModule?: SuperAgentDesignModuleId | null,
): { modeId: SuperAgentCreationModeId | null; optionsPatch?: Partial<ModeComposerOptions> } {
  if (mode === 'design') {
    if (designModule && isDesignScenario(designModule)) {
      return { modeId: 'design', optionsPatch: designScenarioOptionsPatch(designModule) };
    }
    return { modeId: 'design', optionsPatch: { designFormat: 'image' } };
  }
  if (mode === 'website') {
    return { modeId: 'design', optionsPatch: designScenarioOptionsPatch('prototype') };
  }
  if (mode === 'deck') {
    return { modeId: 'design', optionsPatch: designScenarioOptionsPatch('deck') };
  }
  if (mode === 'image') {
    return { modeId: 'design', optionsPatch: { designFormat: 'image' } };
  }
  return { modeId: mode };
}

const PRIMARY_STARTERS: {
  key?: string;
  id: SuperAgentCreationModeId;
  designModule?: SuperAgentDesignModuleId;
  tone: 'coding' | 'agent' | 'image' | 'video' | 'audio';
  icon: string;
  title: string;
  featured?: boolean;
  badge?: string;
}[] = [
  { id: 'game', tone: 'agent', icon: 'gamepad-line', title: 'Build a game', featured: true, badge: 'New' },
  { key: 'design', id: 'design', tone: 'image', icon: 'palette-line', title: 'Design Studio', badge: 'New' },
  { key: 'image', id: 'design', designModule: 'image', tone: 'image', icon: 'image-line', title: 'Generate image' },
  { id: 'motion', tone: 'video', icon: 'movie-line', title: 'Make a video' },
  { id: 'audio', tone: 'audio', icon: 'music-2-line', title: 'Create audio' },
];

const EXTRA_STARTERS: {
  key: string;
  id: SuperAgentCreationModeId;
  designModule?: SuperAgentDesignModuleId;
  tone: 'coding' | 'agent' | 'image' | 'video' | 'audio';
  icon: string;
  title: string;
}[] = [
  { key: 'coding', id: 'coding', tone: 'coding', icon: 'code-s-slash-line', title: 'Coding' },
  { key: 'media', id: 'media', tone: 'video', icon: 'clapperboard-line', title: 'Cinema video' },
  { key: 'deck', id: 'design', designModule: 'deck', tone: 'audio', icon: 'slideshow-line', title: 'Create slides' },
  { key: 'website', id: 'design', designModule: 'prototype', tone: 'image', icon: 'layout-line', title: 'Build a website' },
];

const COMPOSER_MODES = [...PRIMARY_STARTERS, ...EXTRA_STARTERS]
  .map(starter => findSuperAgentMode(starter.id))
  .filter((mode, index, all): mode is NonNullable<typeof mode> => mode !== null && all.findIndex(item => item?.id === mode.id) === index);

export type AgentSelection = {
  runtimeId?: string;
  engine: SuperAgentEngine;
  model: string;
  reasoning: string;
};

export function ConversationStream({
  active = true,
  chat,
  requestedMode = null,
  requestedDesignModule = null,
  playingGameId = null,
  loading,
  loadFailed,
  sending,
  sidebarOpen,
  viewerOpen,
  counts,
  attachments,
  draftSeed = null,
  gameTemplateSeed = null,
  agents,
  agentsLoaded = true,
  runtimes,
  localDirectAvailable = true,
  selection,
  permissionMode,
  followUpBehavior = 'steer',
  onBack,
  onChangeRequestedMode,
  onPlayGame,
  onDeployGame,
  onRetryLoad,
  onOpenSidebar,
  onToggleViewer,
  onRenameChat,
  onChangeSelection,
  onChangePermissionMode,
  onChangeFollowUpBehavior,
  onSend,
  onUpdateQueued,
  onDeleteQueued,
  onSendQueuedNow,
  onStop,
  onApprove,
  onResourcesUploaded,
  onAttachmentsChange,
  onOpenArtifactId,
  onOpenChangedFile,
  onPreviewAttachment,
  onOpenWebUrl,
  onCopyText,
  onNotify,
  onOpenAccountSettings,
  onOpenInDesignStudio,
  onOpenInMotionStudio,
  onOpenInAssets,
  onOpenInBrandKit,
  onOpenAgentSettings,
  onOpenRuntimeSettings,
  onOpenModelSettings,
  onOpenGameStudio,
  onOpenMcp,
  onError,
}: {
  active?: boolean;
  chat: SuperAgentChat | null;
  requestedMode?: SuperAgentCreationModeId | null;
  requestedDesignModule?: SuperAgentDesignModuleId | null;
  playingGameId?: string | null;
  loading: boolean;
  loadFailed: boolean;
  sending: boolean;
  sidebarOpen: boolean;
  viewerOpen: boolean;
  counts: SuperAgentResourceCounts | null;
  attachments: SuperAgentResourceAttachment[];
  draftSeed?: {
    id: number;
    text: string;
    hiddenInstructions?: string;
    contextTags?: SuperAgentContextTag[];
    mode?: SuperAgentCreationModeId;
    designModule?: SuperAgentDesignModuleId;
  } | null;
  gameTemplateSeed?: { id: number; game: GameCard } | null;
  agents: LocalAgent[];
  agentsLoaded?: boolean;
  runtimes?: AgentRuntimeInfo[];
  localDirectAvailable?: boolean;
  selection: AgentSelection;
  permissionMode: SuperAgentPermissionMode;
  followUpBehavior?: SuperAgentFollowUpMode;
  onBack?: () => void;
  onChangeRequestedMode?: (mode: SuperAgentCreationModeId | null) => void;
  onPlayGame?: (game: GameCard) => void;
  onDeployGame?: (game: GameCard) => void;
  onRetryLoad: () => void;
  onOpenSidebar: () => void;
  onToggleViewer: () => void;
  onRenameChat: (title: string) => Promise<void> | void;
  onChangeSelection: (next: AgentSelection) => void;
  onChangePermissionMode: (next: SuperAgentPermissionMode) => void;
  onChangeFollowUpBehavior?: (next: SuperAgentFollowUpMode) => void;
  onSend: (
    text: string,
    meta?: {
      hiddenInstructions?: string;
      contextTags?: SuperAgentContextTag[];
      mode?: SuperAgentCreationModeId;
      workingDir?: string;
      overrideAttachments?: SuperAgentResourceAttachment[];
      initialArtifact?: Partial<SuperAgentArtifact>;
      followUpBehavior?: SuperAgentFollowUpMode;
    },
  ) => Promise<boolean>;
  onUpdateQueued?: (
    queueId: string,
    patch: {
      text: string;
      attachments: SuperAgentResourceAttachment[];
      contextTags?: SuperAgentContextTag[];
      hiddenInstructions?: string;
      mode?: SuperAgentCreationModeId | null;
      workingDir?: string;
    },
  ) => Promise<boolean>;
  onDeleteQueued?: (queueId: string) => Promise<void> | void;
  onSendQueuedNow?: (queueId: string) => Promise<void> | void;
  onStop: () => void;
  onApprove: (approvalId: string, accepted: boolean, alwaysAllow?: boolean) => void;
  onResourcesUploaded?: () => void;
  onAttachmentsChange: (next: SuperAgentResourceAttachment[]) => void;
  onOpenArtifactId: (artifactId: string) => void;
  onOpenChangedFile?: (file: SuperAgentFileOperation) => void;
  onPreviewAttachment: (attachment: SuperAgentResourceAttachment) => void;
  onOpenWebUrl?: (url: string) => void;
  onCopyText: (text: string) => void;
  onNotify?: (message: string, tone?: 'info' | 'error') => void;
  onOpenAccountSettings?: () => void;
  onOpenInDesignStudio?: (projectId: string) => void;
  onOpenInMotionStudio?: (projectId: string) => void;
  onOpenInAssets?: (assetId: string, versionId?: string) => void;
  onOpenInBrandKit?: (kitId?: string) => void;
  onOpenAgentSettings: () => void;
  onOpenRuntimeSettings?: () => void;
  onOpenModelSettings?: () => void;
  onOpenGameStudio?: () => void;
  onOpenMcp: () => void;
  onError: (message: string) => void;
}) {
  const { t, locale } = useI18n();
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const cancelRenameRef = useRef(false);
  const [resourceMenuOpen, setResourceMenuOpen] = useState(false);
  const [resourceCategory, setResourceCategory] = useState<ResourceCategoryTab>('all');
  const [moreStartersOpen, setMoreStartersOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [approvalMenuOpen, setApprovalMenuOpen] = useState(false);
  const [browsingEngine, setBrowsingEngine] = useState<SuperAgentEngine>(selection.engine);
  const [inspectingEngine, setInspectingEngine] = useState<SuperAgentEngine | null>(null);
  const inspectedEnginesRef = useRef<Set<SuperAgentEngine>>(new Set());
  const initialResolvedMode = resolveCreationModeEntry(requestedMode, requestedDesignModule);
  const [activeModeId, setActiveModeId] = useState<SuperAgentCreationModeId | null>(() => initialResolvedMode.modeId);
  const previousRequestedMode = useRef(requestedMode);
  const [modeOptions, setModeOptions] = useState<ModeComposerOptions>(() => ({
    ...DEFAULT_MODE_COMPOSER_OPTIONS,
    ...initialResolvedMode.optionsPatch,
  }));
  const [scaffoldingGame, setScaffoldingGame] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<{
    id: string;
    text: string;
    attachments: SuperAgentResourceAttachment[];
    contextTags?: SuperAgentContextTag[];
    startedAt: number;
  } | null>(null);
  const [previewingChipKey, setPreviewingChipKey] = useState<string | null>(null);
  const mediaModelsRef = useRef<Model[]>([]);
  const mediaRoutesRef = useRef<GatewayStatus['routes']>({});
  const activeMode = findSuperAgentMode(activeModeId);
  const headerIntentMeta = superAgentIntentMeta(
    chat?.intent ?? (
      activeMode
        ? activeMode.id === 'design'
          ? (modeOptions.designFormat === 'image'
            ? 'image'
            : (modeOptions.designScenario === 'deck' || modeOptions.designScenario === 'document' ? 'slides' : 'design'))
          : modeToSuperAgentIntent(activeMode.id)
        : undefined
    ),
  );
  const updateModeOptions = useCallback((patch: Partial<ModeComposerOptions>) => {
    setModeOptions(prev => ({ ...prev, ...patch }));
  }, []);
  const enterMode = useCallback((mode: SuperAgentCreationModeId | null, designModule?: SuperAgentDesignModuleId | null) => {
    const resolved = resolveCreationModeEntry(mode, designModule);
    setActiveModeId(resolved.modeId);
    if (resolved.optionsPatch) {
      setModeOptions(prev => ({ ...prev, ...resolved.optionsPatch }));
    }
  }, []);
  useEffect(() => {
    if (activeModeId === 'motion') {
      updateModeOptions({ motionEngine: DEFAULT_MODE_COMPOSER_OPTIONS.motionEngine });
    } else if (activeModeId === 'media') {
      updateModeOptions({ mediaSubMode: DEFAULT_MODE_COMPOSER_OPTIONS.mediaSubMode });
    }
  }, [activeModeId, updateModeOptions]);
  const handleCatalogChange = useCallback((cat: { models: Model[]; routes: GatewayStatus['routes'] }) => {
    mediaModelsRef.current = cat.models;
    mediaRoutesRef.current = cat.routes;
  }, []);

  useEffect(() => {
    setBrowsingEngine(selection.engine);
  }, [selection.engine]);

  const appliedDraftSeedRef = useRef<number | null>(null);
  const pendingHiddenInstructionsRef = useRef<string | undefined>(undefined);
  const pendingContextTagsRef = useRef<SuperAgentContextTag[] | undefined>(undefined);
  useEffect(() => {
    if (!draftSeed || appliedDraftSeedRef.current === draftSeed.id) return;
    appliedDraftSeedRef.current = draftSeed.id;
    setText(draftSeed.text);
    pendingHiddenInstructionsRef.current = draftSeed.hiddenInstructions?.trim() || undefined;
    pendingContextTagsRef.current = draftSeed.contextTags?.length ? draftSeed.contextTags : undefined;
    if (draftSeed.mode && !chat?.messages.length) {
      enterMode(draftSeed.mode, draftSeed.designModule);
    } else if (!draftSeed.mode) {
      setActiveModeId(null);
      setModeOptions(prev => (prev.gameTemplate ? { ...prev, gameTemplate: null } : prev));
    }
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [draftSeed, chat?.messages.length, enterMode]);

  const appliedGameTemplateSeedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!gameTemplateSeed || appliedGameTemplateSeedRef.current === gameTemplateSeed.id) return;
    appliedGameTemplateSeedRef.current = gameTemplateSeed.id;
    const picked = gameTemplateSeed.game;
    if (!chat?.messages.length) {
      setActiveModeId('game');
      setModeOptions(prev => ({
        ...prev,
        gameTemplate: picked,
        gameGenre: picked.genre,
        gameStyle: picked.style,
        gameSetting: picked.setting,
        gameOrientation: picked.orientation ?? 'landscape',
        gameMultiplayer: picked.multiplayer,
        gamePlayableAd: Boolean(picked.playableAd),
      }));
    } else {
      const displayTitle = localizedGameTitle(picked, locale);
      setText(prev => (prev.trim() ? prev : t('Remix · {title}', { title: displayTitle })));
    }
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [gameTemplateSeed, chat?.messages.length, locale, t]);

  useEffect(() => {
    if (!active) {
      setResourceMenuOpen(false);
      setMoreStartersOpen(false);
      setModelMenuOpen(false);
      setApprovalMenuOpen(false);
      setPreviewingChipKey(null);
    }
  }, [active]);

  useEffect(() => {
    if (previewingChipKey && !attachments.some(att => resourceKey(att) === previewingChipKey)) {
      setPreviewingChipKey(null);
    }
  }, [attachments, previewingChipKey]);
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const activeRuntime = useMemo(() => {
    if (!runtimes?.length) return undefined;
    return runtimes.find(rt => rt.id === selection.runtimeId)
      ?? runtimes.find(rt => rt.status === 'online')
      ?? runtimes[0];
  }, [runtimes, selection.runtimeId]);

  const effectiveAgents = activeRuntime ? activeRuntime.agents : agents;
  const runtimeOnline = !activeRuntime || (activeRuntime.status !== 'offline' && activeRuntime.status !== 'disabled');

  const runnableEngines = useMemo(
    () => (runtimeOnline ? effectiveAgents.filter(item => item.installed && item.auth !== 'signed-out') : []),
    [effectiveAgents, runtimeOnline],
  );
  const activeAgent = effectiveAgents.find(item => item.id === selection.engine) ?? effectiveAgents[0];
  const selectedModelMeta = activeAgent?.models.find(m => m.id === selection.model);
  const reasoningEfforts = selectedModelMeta?.reasoning ?? [];
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const pendingApprovals = chat?.approvals ?? [];
  const hasPendingApproval = pendingApprovals.length > 0;
  const approvalKey = pendingApprovals.map(item => item.id).join(',');
  const busy = chat?.state === 'running' || chat?.state === 'waiting';
  const isRunning = chat?.state === 'running' && !hasPendingApproval;
  const queuedMessages = chat?.queuedMessages ?? [];

  useEffect(() => {
    setEditingQueuedId(null);
  }, [chat?.id]);

  useEffect(() => {
    if (editingQueuedId && !queuedMessages.some(item => item.id === editingQueuedId)) {
      setEditingQueuedId(null);
    }
  }, [editingQueuedId, queuedMessages]);

  const hasBrowserAnnotation = attachments.some(att => att.kind === 'browser-annotation');
  const hasAttachedGameProject = attachments.some(att => att.kind === 'game-project');
  const gameBrief = activeMode?.id === 'game'
    ? composeBrief({
        prompt: text,
        genre: modeOptions.gameGenre,
        style: modeOptions.gameStyle,
        setting: modeOptions.gameSetting,
        multiplayer: modeOptions.gameMultiplayer,
      })
    : '';
  const hasGameStudioBrief = activeMode?.id === 'game' && !hasAttachedGameProject && Boolean(modeOptions.gameTemplate || gameBrief);
  const hasDraft = Boolean(text.trim()) || hasBrowserAnnotation || hasGameStudioBrief;
  const canSubmit = hasDraft && !sending && !scaffoldingGame && !hasPendingApproval && !loading && (Boolean(editingQueuedId) || runnableEngines.length > 0);

  const engineChoices = useMemo(() => {
    if (activeRuntime?.kind === 'remote-service') {
      return effectiveAgents.map(agent => ({
        id: agent.id as SuperAgentEngine,
        label: agent.label,
        agent: agent as LocalAgent | undefined,
        ready: Boolean(runtimeOnline && agent.installed && agent.auth !== 'signed-out'),
      }));
    }
    const installed = effectiveAgents.filter(item => item.installed || item.id === selection.engine);
    const list = installed.length > 0
      ? installed
      : effectiveAgents.filter(item => item.id === 'codex' || item.id === 'claude');
    if (list.length === 0) {
      return [
        { id: 'codex', label: 'Codex', agent: undefined as LocalAgent | undefined, ready: false },
        { id: 'claude', label: 'Claude Code', agent: undefined as LocalAgent | undefined, ready: false },
      ];
    }
    return list.map(agent => ({
      id: agent.id as SuperAgentEngine,
      label: agent.label,
      agent: agent as LocalAgent | undefined,
      ready: Boolean(runtimeOnline && agent.installed && agent.auth !== 'signed-out'),
    }));
  }, [activeRuntime?.kind, effectiveAgents, runtimeOnline, selection.engine]);

  const browsingChoice = engineChoices.find(item => item.id === browsingEngine) ?? engineChoices[0];

  // Proactively prewarm installed un-inspected local agents (e.g. Antigravity, Codex, Claude)
  // in the background when Super Agent becomes active so switching agents in the picker is instant.
  useEffect(() => {
    if (!active) return;
    if (activeRuntime?.kind === 'remote-service') return;
    if (activeRuntime?.kind === 'local-bridge' && activeRuntime.status !== 'online') return;
    const runtimeKey = activeRuntime?.id ?? 'local';
    const candidates = engineChoices
      .map(item => item.agent)
      .filter((agent): agent is LocalAgent => Boolean(
        agent
        && agent.installed
        && !agent.checkedAt
        && agent.models.length === 0
        && !inspectedEnginesRef.current.has(`${runtimeKey}:${agent.id}`),
      ))
      .slice(0, 4);
    if (!candidates.length) return;
    let cancelled = false;
    for (const target of candidates) {
      inspectedEnginesRef.current.add(`${runtimeKey}:${target.id}`);
      const req = activeRuntime?.kind === 'local-bridge'
        ? inspectBridgeAgent(activeRuntime.id, target.id).then(() => { if (!cancelled) notifyRuntimesChanged(); })
        : gatewayRequest(`settings/agents/${target.id}/inspect`, 'POST', {}).then(() => { if (!cancelled) notifyAgentsChanged(); });
      void req.catch(() => { /* keep fallback default option */ });
    }
    return () => {
      cancelled = true;
    };
  }, [active, activeRuntime?.id, activeRuntime?.kind, activeRuntime?.status, engineChoices]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    if (activeRuntime?.kind === 'remote-service') return;
    if (activeRuntime?.kind === 'local-bridge' && activeRuntime.status !== 'online') return;
    const target = browsingChoice?.agent;
    const inspectKey = `${activeRuntime?.id ?? 'local'}:${browsingChoice?.id ?? ''}`;
    if (!target?.installed || target.checkedAt || target.models.length > 0 || inspectedEnginesRef.current.has(inspectKey)) {
      return;
    }
    inspectedEnginesRef.current.add(inspectKey);
    setInspectingEngine(browsingChoice.id);
    let cancelled = false;
    const req = activeRuntime?.kind === 'local-bridge'
      ? inspectBridgeAgent(activeRuntime.id, target.id).then(() => { if (!cancelled) notifyRuntimesChanged(); })
      : gatewayRequest(`settings/agents/${target.id}/inspect`, 'POST', {}).then(() => { if (!cancelled) notifyAgentsChanged(); });
    void req
      .catch(() => { /* keep fallback default option */ })
      .finally(() => {
        if (!cancelled) setInspectingEngine(current => (current === browsingChoice.id ? null : current));
      });
    return () => {
      cancelled = true;
    };
  }, [modelMenuOpen, activeRuntime?.id, activeRuntime?.kind, activeRuntime?.status, browsingChoice?.id, browsingChoice?.agent]);

  const activeProviderRef = { id: activeAgent?.icon ?? selection.engine, custom: false };
  const triggerPrimaryLabel = selectedModelMeta?.label
    ?? (selection.model !== 'default' ? selection.model : activeAgent?.label ?? selection.engine);
  const triggerSecondaryLabel = selection.reasoning !== 'default' && reasoningEfforts.includes(selection.reasoning)
    ? t(selection.reasoning)
    : selection.model !== 'default'
      ? (activeAgent?.label ?? selection.engine)
      : t('Default');

  useEffect(() => {
    if (requestedMode && !chat?.messages.length) {
      enterMode(requestedMode, requestedDesignModule);
    } else if (!requestedMode && previousRequestedMode.current && !chat?.id && !draftSeed?.mode) {
      setActiveModeId(null);
    }
    previousRequestedMode.current = requestedMode;
  }, [requestedMode, requestedDesignModule, chat?.id, chat?.messages.length, draftSeed?.mode, enterMode]);

  useEffect(() => {
    setRenaming(false);
    if (requestedMode && !chat?.messages.length) {
      enterMode(requestedMode, requestedDesignModule);
    } else if (!draftSeed || appliedDraftSeedRef.current !== draftSeed.id || !draftSeed.mode) {
      setActiveModeId(null);
      pendingHiddenInstructionsRef.current = undefined;
      pendingContextTagsRef.current = undefined;
      setModeOptions(prev => (prev.gameTemplate ? { ...prev, gameTemplate: null } : prev));
    }
    followRef.current = true;
  }, [chat?.id]);

  const toggleResourceAttachment = (item: SuperAgentResourceAttachment) => {
    const key = resourceKey(item);
    const exists = attachments.some(existing => resourceKey(existing) === key);
    if (exists) {
      onAttachmentsChange(attachments.filter(existing => resourceKey(existing) !== key));
    } else {
      onAttachmentsChange([...attachments, item].slice(0, 30));
      if (attachments.length < 30 && item.kind === 'motion-template') {
        if (activeModeId === 'motion') updateModeOptions({ motionEngine: 'motion' });
        else if (activeModeId === 'media') updateModeOptions({ mediaSubMode: 'motion' });
      }
    }
  };

  useEffect(() => {
    const hasTimeline = Boolean(chat?.messages.length || chat?.approvals.length);
    if (hasTimeline && followRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [chat?.updatedAt, chat?.messages.length, chat?.approvals.length]);

  useEffect(() => {
    if (!approvalKey) return;
    followRef.current = true;
    const raf = window.requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [approvalKey]);

  useEffect(() => {
    if (!chat?.messages.length && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [activeModeId, chat?.id, chat?.messages.length]);

  const exitActiveMode = useCallback(() => {
    setActiveModeId(null);
    updateModeOptions({ gameTemplate: null });
    if (requestedMode) onChangeRequestedMode?.(null);
  }, [requestedMode, onChangeRequestedMode, updateModeOptions]);

  const switchActiveMode = (value: string) => {
    const mode = findSuperAgentMode(value);
    if (!mode) return;
    setActiveModeId(mode.id);
    onChangeRequestedMode?.(mode.id);
  };

  const handleStartEditQueued = (item: SuperAgentQueuedMessage) => {
    setEditingQueuedId(item.id);
    setText(item.text);
    onAttachmentsChange(item.attachments ? [...item.attachments] : []);
    pendingHiddenInstructionsRef.current = item.hiddenInstructions;
    pendingContextTagsRef.current = item.contextTags;
    if (item.mode && findSuperAgentMode(item.mode)) {
      setActiveModeId(item.mode);
      if (item.workingDir) {
        updateModeOptions({ codingWorkdir: item.workingDir });
      }
    } else {
      setActiveModeId(null);
    }
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const handleCancelEditQueued = () => {
    setEditingQueuedId(null);
    setText('');
    onAttachmentsChange([]);
    pendingHiddenInstructionsRef.current = undefined;
    pendingContextTagsRef.current = undefined;
    setActiveModeId(null);
  };

  const handleSubmit = async (overrideBehavior?: SuperAgentFollowUpMode) => {
    if (!canSubmit) return;
    if (!editingQueuedId && activeMode?.id === 'game' && !chat?.messages.length && !attachments.some(att => att.kind === 'game-project')) {
      const selectedTemplate = modeOptions.gameTemplate;
      setScaffoldingGame(true);
      try {
        const created = selectedTemplate && !selectedTemplate.external
          ? await gameApi.remix(selectedTemplate.id)
          : await gameApi.create(
              selectedTemplate?.external
                ? {
                    prompt: [communityRemixPrompt(selectedTemplate), text.trim()].filter(Boolean).join('\n\n'),
                    genre: modeOptions.gameGenre ?? selectedTemplate.genre,
                    style: modeOptions.gameStyle ?? selectedTemplate.style,
                    setting: modeOptions.gameSetting ?? selectedTemplate.setting,
                    multiplayer: modeOptions.gameMultiplayer,
                    orientation: modeOptions.gameOrientation,
                    playableAd: isPlayableAd(modeOptions),
                  }
                : {
                    prompt: text.trim() || gameBrief,
                    genre: modeOptions.gameGenre,
                    style: modeOptions.gameStyle,
                    setting: modeOptions.gameSetting,
                    multiplayer: modeOptions.gameMultiplayer,
                    orientation: modeOptions.gameOrientation,
                    playableAd: isPlayableAd(modeOptions),
                  },
            );
        rememberInstruction(created.game.id, created.agentInstruction);
        const displayTitle = localizedGameTitle(created.game, locale);
        const ready = created.game.status === 'ready' || created.game.status === 'published';
        const userVisiblePrompt = text.trim()
          || (selectedTemplate
            ? t('Remix · {title}', { title: localizedGameTitle(selectedTemplate, locale) })
            : buildGameUserPrompt(created.game, locale));
        const hiddenInstructions = buildGameHiddenInstructions(
          created.game,
          created.agentInstruction,
          selectedTemplate && text.trim() ? text.trim() : undefined,
        );
        const contextTags: SuperAgentContextTag[] = [
          ...buildGameContextTags({ ...created.game, playableAd: isPlayableAd(modeOptions) }, t),
          ...(selectedTemplate
            ? [{ kind: 'param' as const, label: `${t('Remix')} · ${localizedGameTitle(selectedTemplate, locale)}` }]
            : []),
        ];
        const nextAttachments = [...attachments, toGameResourceAttachment(created.game, displayTitle)];
        const ok = await onSend(userVisiblePrompt, {
          hiddenInstructions,
          contextTags,
          mode: 'game',
          overrideAttachments: nextAttachments,
          ...(ready ? { initialArtifact: toGameArtifact(created.game, displayTitle) } : {}),
        });
        if (ok) {
          setText('');
          pendingHiddenInstructionsRef.current = undefined;
          pendingContextTagsRef.current = undefined;
          setActiveModeId(null);
          updateModeOptions({ gameTemplate: null });
          followRef.current = true;
        }
        return;
      } catch {
        // Fall back to prompt prefix when offline or local game service is unavailable.
      } finally {
        setScaffoldingGame(false);
      }
    }

    const hasInputImage = attachments.some(att => att.kind === 'asset' && att.modality === 'image');
    const mediaExtra = {
      routes: mediaRoutesRef.current,
      hasInputImage,
    };
    const prefix = activeMode
      ? formatModePromptPrefix(activeMode, modeOptions, mediaModelsRef.current, mediaExtra)
      : '';
    const modeDirective = activeMode
      ? buildModeHiddenDirective(activeMode, modeOptions, mediaModelsRef.current, mediaExtra)
      : undefined;
    const annotationSummary = attachments
      .filter(att => att.kind === 'browser-annotation')
      .map(att => att.annotation?.comment?.trim() || '')
      .filter(Boolean)
      .join('\n')
      || (hasBrowserAnnotation ? t('Update the page based on the attached browser preview annotations.') : '');
    const rawBody = text.trim() || annotationSummary || prefix;
    const hiddenInstructions = [
      rawBody === prefix ? '' : prefix,
      modeDirective,
      pendingHiddenInstructionsRef.current,
    ].filter(Boolean).join('\n\n') || undefined;
    const contextTags = activeMode
      ? buildModeContextTags(activeMode, modeOptions, mediaModelsRef.current, t, locale, mediaExtra)
      : pendingContextTagsRef.current;
    if (editingQueuedId && onUpdateQueued) {
      const ok = await onUpdateQueued(editingQueuedId, {
        text: rawBody,
        attachments,
        contextTags: contextTags ?? [],
        hiddenInstructions: hiddenInstructions ?? '',
        mode: activeMode?.id ?? null,
        ...(activeMode?.id === 'coding' ? { workingDir: modeOptions.codingWorkdir.trim() } : {}),
      });
      if (ok) {
        setEditingQueuedId(null);
        setText('');
        onAttachmentsChange([]);
        pendingHiddenInstructionsRef.current = undefined;
        pendingContextTagsRef.current = undefined;
        setActiveModeId(null);
        updateModeOptions({ gameTemplate: null });
      }
      return;
    }

    const effectiveFollowUp = isRunning ? (overrideBehavior ?? followUpBehavior) : undefined;
    const isImmediateTurn = effectiveFollowUp !== 'queue';
    if (isImmediateTurn) {
      setPendingSubmission({
        id: `optimistic-${Date.now()}`,
        text: rawBody,
        attachments,
        contextTags,
        startedAt: Date.now(),
      });
      followRef.current = true;
    }
    try {
      const ok = await onSend(rawBody, {
        ...(hiddenInstructions ? { hiddenInstructions } : {}),
        ...(contextTags?.length ? { contextTags } : {}),
        ...(activeMode ? { mode: activeMode.id } : {}),
        ...(activeMode?.id === 'coding' && modeOptions.codingWorkdir.trim()
          ? { workingDir: modeOptions.codingWorkdir.trim() }
          : {}),
        ...(effectiveFollowUp ? { followUpBehavior: effectiveFollowUp } : {}),
      });
      if (ok) {
        setText('');
        pendingHiddenInstructionsRef.current = undefined;
        pendingContextTagsRef.current = undefined;
        setActiveModeId(null);
        updateModeOptions({ gameTemplate: null });
        if (effectiveFollowUp !== 'queue') {
          followRef.current = true;
        }
      }
    } finally {
      if (isImmediateTurn) {
        setPendingSubmission(null);
      }
    }
  };

  const handleFilesUpload = async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    setUploading(true);
    try {
      const added: SuperAgentResourceAttachment[] = [];
      for (const file of Array.from(files)) {
        const asset = await uploadLibraryAsset(file);
        const current = assetVersion(asset);
        added.push({
          id: asset.id,
          kind: 'asset',
          title: asset.name,
          subtitle: current?.model || current?.source || asset.modality,
          modality: asset.modality,
          versionId: asset.currentVersionId,
          previewUrl: assetMediaUrl(asset.id, asset.currentVersionId),
        });
      }
      const next = [...attachments];
      for (const item of added) {
        if (!next.some(existing => resourceKey(existing) === resourceKey(item))) {
          next.push(item);
        }
      }
      onAttachmentsChange(next.slice(0, 30));
    } catch (error) {
      onError(error instanceof Error ? error.message : t('Could not upload file'));
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const artifactCount = chat?.artifacts.length ?? 0;

  return (
    <section
      className="om-sa-stream"
      data-mode={activeMode?.id || undefined}
      aria-label={t('Super Agent conversation')}
      onDragOver={event => {
        if (hasPendingApproval) return;
        if (event.dataTransfer?.types?.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragging(false);
        }
      }}
      onDrop={event => {
        event.preventDefault();
        setDragging(false);
        if (hasPendingApproval) return;
        void handleFilesUpload(event.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className="om-sa-drop-overlay" aria-hidden="true">
          <RemixIcon name="upload-2-line" size={28} />
          <strong>{t('Drop media files to attach to this conversation')}</strong>
        </div>
      )}

      <header className="om-sa-stream-head">
        <div className="om-sa-stream-head-left">
          {onBack && <WorkspaceBack inline fallback={onBack} />}
          {!sidebarOpen && (
            <Tooltip label={t('Open sidebar')}>
              <IconButton
                variant="ghost"
                className="motion-icon-button"
                aria-label={t('Open sidebar')}
                onClick={onOpenSidebar}
                icon={<RemixIcon name="side-bar-line" size={16} />}
              />
            </Tooltip>
          )}
          {chat && renaming ? (
            <form
              className="om-sa-head-rename"
              onSubmit={event => {
                event.preventDefault();
                const next = draftTitle.trim();
                setRenaming(false);
                if (next && next !== chat.title) void onRenameChat(next);
              }}
            >
              <span
                className="om-sa-stream-title-icon"
                data-tone={headerIntentMeta.tone}
                title={t(headerIntentMeta.label)}
                aria-hidden="true"
              >
                <RemixIcon name={headerIntentMeta.icon} size={15} />
              </span>
              <input
                autoFocus
                maxLength={100}
                value={draftTitle}
                aria-label={t('Conversation name')}
                onFocus={event => event.currentTarget.select()}
                onChange={event => setDraftTitle(event.target.value)}
                onBlur={() => {
                  if (cancelRenameRef.current) {
                    cancelRenameRef.current = false;
                    return;
                  }
                  const next = draftTitle.trim();
                  setRenaming(false);
                  if (next && next !== chat.title) void onRenameChat(next);
                }}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    cancelRenameRef.current = true;
                    setRenaming(false);
                  }
                }}
              />
            </form>
          ) : (
            <Button
              variant="plain"
              type="button"
              className="om-sa-stream-title"
              disabled={!chat}
              onClick={() => {
                if (!chat) return;
                setDraftTitle(chat.title);
                setRenaming(true);
              }}
            >
              <span
                className="om-sa-stream-title-icon"
                data-tone={headerIntentMeta.tone}
                title={t(headerIntentMeta.label)}
                aria-hidden="true"
              >
                <RemixIcon name={headerIntentMeta.icon} size={15} />
              </span>
              <span>{chat ? chat.title : t('New conversation')}</span>
              {chat && <RemixIcon name="edit-line" size={12} />}
            </Button>
          )}
          {chat && !renaming && chat.projectDir && (
            <Tooltip label={t('Project directory: {path}', { path: chat.projectDir })}>
              <Button
                variant="plain"
                type="button"
                className="om-sa-head-dir-btn"
                aria-label={t('Copy project directory')}
                onClick={() => onCopyText(chat.projectDir!)}
              >
                <RemixIcon name="folder-line" size={13} />
                <span>{compactDirLabel(chat.projectDir)}</span>
              </Button>
            </Tooltip>
          )}
          {chat && (chat.state !== 'idle' || hasPendingApproval) && (() => {
            const headerState = hasPendingApproval ? 'waiting' : chat.state;
            return (
              <span
                className="om-badge om-sa-head-status-badge"
                data-active={headerState === 'running' || undefined}
                data-state={headerState}
              >
                {headerState === 'running' && (
                  <span className="om-sa-head-spinner" aria-hidden="true">
                    <RemixIcon name="loader-4-line" size={12} />
                  </span>
                )}
                {headerState === 'waiting' && (
                  <span className="om-sa-head-status-icon" aria-hidden="true">
                    <RemixIcon name="shield-check-line" size={12} />
                  </span>
                )}
                <span>{t(headerState === 'running' ? 'Working…' : headerState === 'waiting' ? 'Approval needed' : headerState === 'failed' ? 'Stopped' : 'Cancelled')}</span>
              </span>
            );
          })()}
        </div>

        <div className="om-sa-stream-head-actions">
          <Tooltip label={artifactCount > 0 ? `${t('Artifact Viewer')} (${artifactCount})` : t('Artifact Viewer')}>
            <IconButton
              variant="plain"
              className="om-sa-head-icon-btn"
              aria-label={t('Artifact Viewer')}
              aria-pressed={viewerOpen}
              data-active={viewerOpen || undefined}
              onClick={onToggleViewer}
              icon={<RemixIcon name="layout-column-line" size={16} />}
            />
          </Tooltip>
        </div>
      </header>

      <div
        ref={listRef}
        className="om-sa-messages"
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
        }}
      >
        {loading ? (
          <div className="om-sa-loading" role="status" aria-label={t('Loading conversation…')}>
            <OpenDesignLoadingMark height={26} />
            <span className="om-muted">{t('Loading conversation…')}</span>
          </div>
        ) : loadFailed ? (
          <div className="om-empty om-sa-empty-state" role="alert">
            <RemixIcon name="error-warning-line" size={28} />
            <h2>{t('Could not load conversation')}</h2>
            <Button variant="ghost" className="om-button h-auto" onClick={onRetryLoad}>
              <RemixIcon name="refresh-line" size={15} />
              <span>{t('Retry')}</span>
            </Button>
          </div>
        ) : (() => {
          const optimisticMessage: SuperAgentMessage | null = pendingSubmission
            ? {
                id: pendingSubmission.id,
                role: 'user',
                text: pendingSubmission.text,
                createdAt: pendingSubmission.startedAt,
                ...(pendingSubmission.attachments.length ? { attachments: pendingSubmission.attachments } : {}),
                ...(pendingSubmission.contextTags?.length ? { contextTags: pendingSubmission.contextTags } : {}),
              }
            : null;
          const displayChat: SuperAgentChat | null = (() => {
            if (!optimisticMessage) return chat;
            if (!chat) {
              return {
                id: pendingSubmission!.id,
                title: pendingSubmission!.text.slice(0, 60) || t('New conversation'),
                engine: selection.engine,
                model: selection.model,
                permissionMode,
                createdAt: pendingSubmission!.startedAt,
                updatedAt: pendingSubmission!.startedAt,
                state: 'running',
                turnActivity: {
                  phase: 'connecting',
                  label: activeAgent?.label ?? selection.engine,
                  startedAt: pendingSubmission!.startedAt,
                  updatedAt: pendingSubmission!.startedAt,
                },
                messages: [optimisticMessage],
                artifacts: [],
                approvals: [],
              };
            }
            const lastMsg = chat.messages[chat.messages.length - 1];
            const alreadyPresent = lastMsg?.role === 'user' && lastMsg.text.trim() === optimisticMessage.text.trim();
            if (alreadyPresent) return chat;
            return {
              ...chat,
              messages: [...chat.messages, optimisticMessage],
              turnActivity: chat.turnActivity ?? {
                phase: 'connecting',
                label: activeAgent?.label ?? chat.engine,
                startedAt: pendingSubmission!.startedAt,
                updatedAt: pendingSubmission!.startedAt,
              },
            };
          })();
          return (
          <div key={displayChat?.id ?? (activeMode?.id ?? 'welcome')} className="om-sa-stream-transition">
            {!displayChat?.messages.length ? (
              activeMode ? (
            <ModeResourceShowcase
              active={active}
              mode={activeMode}
              attachments={attachments}
              modeOptions={modeOptions}
              playingGameId={playingGameId}
              onChangeModeOptions={updateModeOptions}
              onToggleAttachment={toggleResourceAttachment}
              onPlayGame={onPlayGame}
              onDeployGame={onDeployGame}
              onFocusComposer={() => composerRef.current?.focus()}
              onPickPrompt={prompt => {
                setText(prompt);
                composerRef.current?.focus();
              }}
              onOpenAllResources={category => {
                setResourceCategory(category ?? 'all');
                setResourceMenuOpen(true);
              }}
              onOpenGameStudio={onOpenGameStudio}
              onClose={exitActiveMode}
            />
          ) : (
          <div className="om-sa-home">
            <div className="om-sa-home-hero">
              <h2>{t('What can I create for you?')}</h2>
            </div>

            <div className="om-sa-starter-grid">
              {PRIMARY_STARTERS.map(card => (
                <Button
                  key={card.key ?? card.id}
                  variant="plain"
                  type="button"
                  className="om-sa-starter-card"
                  data-tone={card.tone}
                  onClick={() => {
                    enterMode(card.id, card.designModule);
                    composerRef.current?.focus();
                  }}
                >
                  <span className="om-sa-starter-head">
                    <span className="om-sa-starter-icon" data-tone={card.tone} aria-hidden="true">
                      <RemixIcon name={card.icon} size={20} />
                    </span>
                    {card.badge && (
                      <span className="om-badge" data-nav-badge={card.badge} lang="en">{card.badge}</span>
                    )}
                  </span>
                  <strong>{t(card.title)}</strong>
                </Button>
              ))}

              <Popover
                open={moreStartersOpen}
                onOpenChange={setMoreStartersOpen}
                side="bottom"
                align="end"
                initialFocus={false}
                aria-label={t('Explore more')}
                className="om-agent-settings-popover om-sa-more-popover"
                trigger={
                  <Button
                    variant="plain"
                    type="button"
                    className="om-sa-starter-card om-sa-starter-card-more"
                    data-active={moreStartersOpen || undefined}
                  >
                    <span className="om-sa-starter-icon" aria-hidden="true">
                      <RemixIcon name="more-fill" size={20} />
                    </span>
                    <strong>{t('Explore more')}</strong>
                  </Button>
                }
              >
                <div className="om-sa-more-menu">
                  {EXTRA_STARTERS.map(card => (
                    <Button
                      key={card.key}
                      variant="plain"
                      type="button"
                      className="om-sa-more-item"
                      onClick={() => {
                        setMoreStartersOpen(false);
                        enterMode(card.id, card.designModule);
                        composerRef.current?.focus();
                      }}
                    >
                      <span className="om-sa-starter-icon" data-tone={card.tone} aria-hidden="true">
                        <RemixIcon name={card.icon} size={16} />
                      </span>
                      <span>{t(card.title)}</span>
                    </Button>
                  ))}
                </div>
              </Popover>
            </div>
          </div>
          )
        ) : (
          <ExecutionTimeline
            chat={displayChat}
            busy={busy || Boolean(pendingSubmission)}
            sending={sending || scaffoldingGame || Boolean(pendingSubmission)}
            hideApprovals
            continueDisabled={sending || scaffoldingGame || busy || hasPendingApproval || runnableEngines.length === 0}
            engineLabel={effectiveAgents.find(a => a.id === displayChat.engine)?.label ?? displayChat.engine}
            onOpenArtifactId={onOpenArtifactId}
            onOpenChangedFile={onOpenChangedFile}
            onPreviewAttachment={onPreviewAttachment}
            onOpenWebUrl={onOpenWebUrl}
            onCopyText={onCopyText}
            onNotify={onNotify}
            onOpenAccountSettings={onOpenAccountSettings}
            onOpenInDesignStudio={onOpenInDesignStudio}
            onOpenInMotionStudio={onOpenInMotionStudio}
            onOpenInAssets={onOpenInAssets}
            onOpenInBrandKit={onOpenInBrandKit}
            onApprove={onApprove}
            onContinue={() => void onSend(t('Continue from where you stopped and finish the task.'))}
          />
            )}
          </div>
          );
        })()}
      </div>

      <div className="om-sa-composer-wrap">
        {hasPendingApproval && (
          <div className="om-sa-approval-dock" role="region" aria-label={t('Approval needed')}>
            {pendingApprovals.map(approval => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                sending={sending || scaffoldingGame}
                onApprove={onApprove}
              />
            ))}
          </div>
        )}
        {queuedMessages.length > 0 && (
          <div className="om-sa-queue-panel" role="region" aria-label={t('Queued Messages')}>
            <Button
              variant="plain"
              type="button"
              className="om-sa-queue-head"
              aria-expanded={!queueCollapsed}
              onClick={() => setQueueCollapsed(prev => !prev)}
            >
              <span className="om-sa-queue-title">{t('Queued Messages')}</span>
              <span className="om-sa-queue-count">{queuedMessages.length}</span>
              <span className="om-sa-queue-subtitle">
                {t(isRunning ? 'Sends after agent finishes working' : 'Waiting to send')}
              </span>
              <span className="om-sa-queue-chevron" data-collapsed={queueCollapsed || undefined} aria-hidden="true">
                <RemixIcon name="arrow-down-s-line" size={16} />
              </span>
            </Button>
            {!queueCollapsed && (
              <div className="om-sa-queue-list">
                {queuedMessages.map(item => {
                  const isEditingThis = editingQueuedId === item.id;
                  const hasMeta = isEditingThis || Boolean(item.contextTags?.length) || Boolean(item.attachments?.length);
                  return (
                    <div key={item.id} className="om-sa-queue-row" data-editing={isEditingThis || undefined}>
                      <div className="om-sa-queue-main">
                        <p className="om-sa-queue-text" title={item.text}>{item.text}</p>
                        {hasMeta && (
                          <div className="om-sa-queue-meta">
                            {isEditingThis && (
                              <span className="om-sa-queue-tag" data-tone="editing">
                                <RemixIcon name="edit-line" size={11} />
                                <span>{t('Editing')}</span>
                              </span>
                            )}
                            {item.contextTags?.slice(0, 3).map((tag, idx) => (
                              <span key={`${tag.label}-${idx}`} className="om-sa-queue-tag">
                                {tag.icon && <RemixIcon name={tag.icon} size={11} />}
                                <span>{tag.label}</span>
                              </span>
                            ))}
                            {(item.contextTags?.length ?? 0) > 3 && (
                              <span className="om-sa-queue-tag">+{item.contextTags!.length - 3}</span>
                            )}
                            {item.attachments?.slice(0, 2).map(att => (
                              <span key={resourceKey(att)} className="om-sa-queue-tag">
                                <RemixIcon name={resourceIcon(att)} size={11} />
                                <span>{att.title}</span>
                              </span>
                            ))}
                            {(item.attachments?.length ?? 0) > 2 && (
                              <span className="om-sa-queue-tag">+{item.attachments!.length - 2}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="om-sa-queue-actions">
                        <Tooltip label={t('Send Now')}>
                          <IconButton
                            variant="plain"
                            className="om-sa-queue-action-btn"
                            aria-label={t('Send Now')}
                            disabled={sending || hasPendingApproval}
                            onClick={() => {
                              if (isEditingThis) setEditingQueuedId(null);
                              void onSendQueuedNow?.(item.id);
                            }}
                            icon={<RemixIcon name="arrow-right-line" size={15} />}
                          />
                        </Tooltip>
                        <Tooltip label={t('Edit')}>
                          <IconButton
                            variant="plain"
                            className="om-sa-queue-action-btn"
                            aria-label={t('Edit')}
                            disabled={sending || hasPendingApproval}
                            onClick={() => handleStartEditQueued(item)}
                            icon={<RemixIcon name="edit-line" size={15} />}
                          />
                        </Tooltip>
                        <Tooltip label={t('Delete')}>
                          <IconButton
                            variant="plain"
                            className="om-sa-queue-action-btn"
                            data-tone="danger"
                            aria-label={t('Delete')}
                            disabled={sending}
                            onClick={() => {
                              if (isEditingThis) handleCancelEditQueued();
                              void onDeleteQueued?.(item.id);
                            }}
                            icon={<RemixIcon name="delete-bin-line" size={15} />}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {agentsLoaded && !runnableEngines.length && (
          <div className="om-sa-agent-banner">
            <RemixIcon name="plug-line" size={15} />
            <span>
              {t(
                !localDirectAvailable || (activeRuntime && activeRuntime.kind !== 'local-direct')
                  ? 'Connect a local machine via the Bridge script or add a Custom Agent Service to run Super Agent.'
                  : 'Install and sign in to Codex or Claude Code to run Super Agent.',
              )}
            </span>
            <Button
              variant="ghost"
              className="om-button h-auto"
              onClick={
                !localDirectAvailable || (activeRuntime && activeRuntime.kind !== 'local-direct')
                  ? (onOpenRuntimeSettings ?? onOpenAgentSettings)
                  : onOpenAgentSettings
              }
            >
              {t(
                !localDirectAvailable || (activeRuntime && activeRuntime.kind !== 'local-direct')
                  ? 'Connect Agent Runtime'
                  : 'Configure Local Agent',
              )}
            </Button>
          </div>
        )}

        {activeMode && (
          <ModeComposerTopBar
            active={active}
            modeId={activeMode.id}
            options={modeOptions}
            attachments={attachments}
            disabled={sending || hasPendingApproval}
            onChange={updateModeOptions}
            onCatalogChange={handleCatalogChange}
            onOpenResourcePicker={category => {
              setResourceCategory(category);
              setResourceMenuOpen(true);
            }}
            onOpenModelSettings={() => {
              if (onOpenModelSettings) onOpenModelSettings();
              else onOpenAgentSettings();
            }}
          />
        )}

        <div
          className="om-sa-composer"
          data-approval-pending={hasPendingApproval || undefined}
          data-editing-queued={Boolean(editingQueuedId) || undefined}
        >
          {hasPendingApproval && (
            <div className="om-sa-composer-approval-notice" role="status" aria-live="polite">
              <span className="om-sa-composer-approval-icon" aria-hidden="true">
                <RemixIcon name="error-warning-line" size={15} />
              </span>
              <span className="om-sa-composer-approval-text">
                {pendingApprovals.length === 1
                  ? t('Confirm the pending action above before sending your next message')
                  : t('Confirm {count} pending actions above before sending your next message', { count: pendingApprovals.length })}
              </span>
            </div>
          )}
          {editingQueuedId && !hasPendingApproval && (
            <div className="om-sa-composer-edit-banner" role="status">
              <span className="om-sa-composer-edit-info">
                <RemixIcon name="edit-line" size={14} />
                <span>{t('Editing queued message')}</span>
              </span>
              <Button
                variant="plain"
                type="button"
                className="om-sa-composer-edit-cancel"
                onClick={handleCancelEditQueued}
              >
                {t('Cancel')}
              </Button>
            </div>
          )}
          {(attachments.length > 0 || (activeMode?.id === 'game' && Boolean(modeOptions.gameTemplate))) && (
            <div className="om-sa-composer-chips">
              {activeMode?.id === 'game' && modeOptions.gameTemplate && (
                <span className="om-sa-attachment-chip">
                  <RemixIcon name="gamepad-line" size={13} />
                  <span>{t('Remix · {title}', { title: localizedGameTitle(modeOptions.gameTemplate, locale) })}</span>
                  <IconButton
                    variant="plain"
                    className="om-sa-chip-remove"
                    aria-label={t('Remove {title}', { title: localizedGameTitle(modeOptions.gameTemplate, locale) })}
                    onClick={() => updateModeOptions({ gameTemplate: null })}
                    icon={<RemixIcon name="close-line" size={12} />}
                  />
                </span>
              )}
              {attachments.map(att => {
                const key = resourceKey(att);
                const isBrowserAnnotation = att.kind === 'browser-annotation';
                const chipTitle = isBrowserAnnotation
                  ? (att.annotation?.comment || att.title)
                  : att.title;
                const tooltipLabel = isBrowserAnnotation
                  ? [
                      att.annotation?.element?.componentName,
                      att.annotation?.element?.selector,
                      att.annotation?.pageUrl || att.subtitle,
                    ].filter(Boolean).join(' · ')
                  : '';
                if (!isBrowserAnnotation) {
                  return (
                    <span key={key} className="om-sa-attachment-chip">
                      <RemixIcon name={resourceIcon(att)} size={13} />
                      <span>{chipTitle}</span>
                      <IconButton
                        variant="plain"
                        className="om-sa-chip-remove"
                        aria-label={t('Remove {title}', { title: chipTitle })}
                        onClick={() =>
                          onAttachmentsChange(attachments.filter(item => resourceKey(item) !== key))
                        }
                        icon={<RemixIcon name="close-line" size={12} />}
                      />
                    </span>
                  );
                }

                const annot = att.annotation;
                const sourceLoc = annot?.element?.sourceFile
                  ? `${annot.element.sourceFile}${typeof annot.element.sourceLine === 'number' ? `:${annot.element.sourceLine}` : ''}`
                  : '';
                const chipTrigger = (
                  <Button
                    variant="plain"
                    type="button"
                    className="om-sa-chip-main"
                    aria-label={chipTitle}
                  >
                    {att.previewUrl ? (
                      <img className="om-sa-attachment-thumb" src={att.previewUrl} alt="" />
                    ) : (
                      <RemixIcon name={resourceIcon(att)} size={13} />
                    )}
                    <span>{chipTitle}</span>
                  </Button>
                );

                return (
                  <span
                    key={key}
                    className="om-sa-attachment-chip"
                    data-kind="browser-annotation"
                  >
                    <Popover
                      open={previewingChipKey === key}
                      onOpenChange={open => setPreviewingChipKey(open ? key : null)}
                      side="top"
                      align="start"
                      tooltip={tooltipLabel || undefined}
                      aria-label={chipTitle}
                      className="om-sa-annot-preview-popover"
                      trigger={chipTrigger}
                    >
                      <div className="om-sa-annot-preview-body">
                        {att.previewUrl && (
                          <img className="om-sa-annot-preview-img" src={att.previewUrl} alt={chipTitle} />
                        )}
                        <div className="om-sa-annot-preview-meta">
                          <strong>{chipTitle}</strong>
                          {(annot?.element?.componentName || annot?.element?.selector) && (
                            <code>
                              {annot.element.componentName ? `${annot.element.componentName} · ` : ''}
                              {annot.element.selector}
                            </code>
                          )}
                          {sourceLoc && <small className="om-sa-annot-preview-source">{sourceLoc}</small>}
                          {annot?.region && (
                            <small>
                              {annot.region.width}×{annot.region.height} @ {annot.region.x},{annot.region.y}
                            </small>
                          )}
                          {annot?.consoleErrors && annot.consoleErrors.length > 0 && (
                            <pre className="om-sa-annot-preview-logs">
                              {annot.consoleErrors.slice(0, 4).join('\n')}
                            </pre>
                          )}
                          {(annot?.pageUrl || att.subtitle) && (
                            <small className="om-sa-annot-preview-url">{annot?.pageUrl || att.subtitle}</small>
                          )}
                        </div>
                        <div className="om-sa-annot-preview-actions">
                          <Button
                            variant="plain"
                            type="button"
                            className="om-sa-toolbar-btn"
                            onClick={() => {
                              setPreviewingChipKey(null);
                              onPreviewAttachment(att);
                            }}
                          >
                            <RemixIcon name="eye-line" size={13} />
                            <span>{t('Preview')}</span>
                          </Button>
                        </div>
                      </div>
                    </Popover>
                    <IconButton
                      variant="plain"
                      className="om-sa-chip-remove"
                      aria-label={t('Remove {title}', { title: chipTitle })}
                      onClick={() => {
                        if (previewingChipKey === key) setPreviewingChipKey(null);
                        onAttachmentsChange(attachments.filter(item => resourceKey(item) !== key));
                      }}
                      icon={<RemixIcon name="close-line" size={12} />}
                    />
                  </span>
                );
              })}
              <Button
                variant="plain"
                type="button"
                className="om-sa-chip-clear"
                onClick={() => {
                  onAttachmentsChange([]);
                  updateModeOptions({ gameTemplate: null });
                }}
              >
                {t('Clear')}
              </Button>
            </div>
          )}

          <textarea
            ref={composerRef}
            rows={2}
            value={text}
            disabled={loading || hasPendingApproval}
            maxLength={20000}
            aria-label={t('Message Super Agent')}
            placeholder={
              hasPendingApproval
                ? t('Confirm or decline the pending action above to continue…')
                : editingQueuedId
                  ? t('Edit queued message…')
                  : isRunning
                    ? followUpBehavior === 'queue'
                      ? t('Queue a follow-up message…')
                      : t('Send a follow-up to steer the current run…')
                    : getModeComposerPlaceholder(activeMode, modeOptions, t)
            }
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Escape' && editingQueuedId) {
                event.preventDefault();
                handleCancelEditQueued();
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                const oppositeBehavior =
                  (event.metaKey || event.ctrlKey) && isRunning && !editingQueuedId
                    ? (followUpBehavior === 'queue' ? 'steer' : 'queue')
                    : undefined;
                void handleSubmit(oppositeBehavior);
              }
            }}
          />

          <input
            ref={uploadInputRef}
            type="file"
            multiple
            hidden
            onChange={event => void handleFilesUpload(event.target.files)}
          />

          <div className="om-sa-composer-bar">
            <div className="om-sa-composer-tools">
              <Popover
                open={resourceMenuOpen}
                onOpenChange={next => {
                  setResourceMenuOpen(next);
                  if (!next) setResourceCategory('all');
                }}
                side="top"
                align="start"
                aria-label={t('Attach workspace resources')}
                className="om-sa-resource-popover"
                trigger={
                  <IconButton
                    variant="plain"
                    className="om-sa-composer-icon-btn"
                    data-active={resourceMenuOpen || undefined}
                    aria-label={t('Attach workspace resources')}
                    disabled={uploading || hasPendingApproval}
                    icon={<RemixIcon name={uploading ? 'loader-4-line' : 'add-line'} size={18} />}
                  />
                }
              >
                <ResourcePickerPanel
                  open={resourceMenuOpen}
                  initialCategory={resourceCategory}
                  selected={attachments}
                  onToggle={toggleResourceAttachment}
                  onClear={() => onAttachmentsChange([])}
                  onAddItems={added => {
                    const next = [...attachments];
                    for (const item of added) {
                      if (!next.some(existing => resourceKey(existing) === resourceKey(item))) {
                        next.push(item);
                      }
                    }
                    onAttachmentsChange(next.slice(0, 30));
                  }}
                  onUploaded={onResourcesUploaded}
                  onError={onError}
                />
              </Popover>

              {active && activeMode && (
                <span className="om-sa-active-mode-pill" data-mode={activeMode.id}>
                  <Select
                    appearance="boxed"
                    modal={false}
                    label={t('Creation mode')}
                    value={activeMode.id}
                    onCommit={switchActiveMode}
                    disabled={sending || scaffoldingGame || hasPendingApproval}
                    className="om-sa-mode-select"
                    popupClassName="om-sa-creation-mode-menu"
                    options={COMPOSER_MODES.map(mode => ({
                      value: mode.id,
                      label: t(mode.label),
                      icon: <RemixIcon name={mode.icon} size={13} />,
                    }))}
                  />
                  <IconButton
                    variant="plain"
                    className="om-sa-chip-remove"
                    aria-label={t('Clear mode')}
                    onClick={exitActiveMode}
                    icon={<RemixIcon name="close-line" size={12} />}
                  />
                </span>
              )}

              {activeMode && (
                <ModeComposerControls
                  active={active}
                  modeId={activeMode.id}
                  options={modeOptions}
                  disabled={sending || hasPendingApproval}
                  onChange={updateModeOptions}
                />
              )}

              <Popover
                open={modelMenuOpen}
                onOpenChange={setModelMenuOpen}
                side="top"
                align="start"
                aria-label={t('Agent & model')}
                className="om-agent-settings-popover om-sa-model-popover"
                trigger={
                  <Button
                    variant="plain"
                    type="button"
                    className="om-sa-model-trigger"
                    disabled={busy || sending}
                  >
                    <span className="om-sa-model-avatar" data-engine={selection.engine} aria-hidden="true">
                      {selection.model !== 'default' ? (
                        <ModelAvatar name={triggerPrimaryLabel} modelId={selection.model} provider={activeProviderRef} />
                      ) : (
                        <ProviderAvatar name={activeAgent?.label ?? selection.engine} provider={activeProviderRef} />
                      )}
                    </span>
                    <span className="om-sa-model-trigger-name">{triggerPrimaryLabel}</span>
                    {triggerSecondaryLabel && (
                      <span className="om-sa-model-trigger-sub" data-engine={selection.engine}>{triggerSecondaryLabel}</span>
                    )}
                    {activeRuntime && activeRuntime.kind !== 'local-direct' && (
                      <span className="om-sa-runtime-chip">
                        <RemixIcon name={activeRuntime.kind === 'local-bridge' ? 'link' : 'plug-line'} size={11} />
                        <span>{t(activeRuntime.name)}</span>
                      </span>
                    )}
                    <RemixIcon name="arrow-down-s-line" size={15} />
                  </Button>
                }
              >
                <div className="om-sa-model-menu">
                  {runtimes && (runtimes.length > 1 || (activeRuntime && activeRuntime.kind !== 'local-direct')) && (
                    <div className="om-sa-runtime-pills" role="group" aria-label={t('Execution runtime')}>
                      {runtimes.map(rt => {
                        const isRtActive = activeRuntime?.id === rt.id;
                        const icon = rt.kind === 'local-bridge' ? 'link' : rt.kind === 'remote-service' ? 'plug-line' : 'computer-line';
                        return (
                          <Button
                            key={rt.id}
                            variant="plain"
                            type="button"
                            className="om-sa-runtime-pill"
                            aria-pressed={isRtActive}
                            data-active={isRtActive || undefined}
                            disabled={rt.status === 'disabled'}
                            onClick={() => {
                              const nextEngine = rt.runnableAgentIds.includes(selection.engine)
                                ? selection.engine
                                : rt.runnableAgentIds[0] ?? rt.agents[0]?.id ?? selection.engine;
                              setBrowsingEngine(nextEngine);
                              onChangeSelection({
                                runtimeId: rt.id,
                                engine: nextEngine,
                                model: 'default',
                                reasoning: 'default',
                              });
                            }}
                          >
                            <RemixIcon name={icon} size={13} />
                            <span>{t(rt.name)}</span>
                            <span
                              className="om-sa-runtime-pill-dot"
                              data-online={rt.status === 'online' || undefined}
                              aria-hidden="true"
                            />
                          </Button>
                        );
                      })}
                    </div>
                  )}

                  <div className="om-sa-model-agent-select-wrap">
                    <Select
                      label={t('Local Agent')}
                      value={browsingChoice.id}
                      className="om-sa-model-agent-select"
                      options={engineChoices.map(choice => ({
                        value: choice.id,
                        label: choice.label,
                        icon: (
                          <span className="om-sa-model-avatar" data-engine={choice.id} aria-hidden="true">
                            <ProviderAvatar
                              name={choice.label}
                              provider={{ id: choice.agent?.icon ?? choice.id, custom: false }}
                            />
                          </span>
                        ),
                        description: choice.ready
                          ? undefined
                          : !runtimeOnline
                            ? t('Runtime offline')
                            : (!choice.agent?.installed ? t('Not installed') : t('Sign-in required')),
                      }))}
                      onCommit={nextId => {
                        const chosen = engineChoices.find(item => item.id === nextId);
                        setBrowsingEngine(nextId);
                        if (chosen?.ready && selection.engine !== nextId) {
                          onChangeSelection({
                            ...(activeRuntime ? { runtimeId: activeRuntime.id } : selection.runtimeId ? { runtimeId: selection.runtimeId } : {}),
                            engine: nextId,
                            model: 'default',
                            reasoning: 'default',
                          });
                        }
                      }}
                    />
                  </div>

                  {(() => {
                    const choice = browsingChoice;
                    const agentModels = choice.ready ? (choice.agent?.models ?? []) : [];
                    const providerRef = { id: choice.agent?.icon ?? choice.id, custom: false };
                    const isDefaultSelected = selection.engine === choice.id && selection.model === 'default';
                    const hasCustomSelected =
                      selection.engine === choice.id
                      && selection.model !== 'default'
                      && !agentModels.some(m => m.id === selection.model);

                    return (
                      <div className="om-sa-model-list" role="listbox" aria-label={choice.label}>
                        {!choice.ready ? (
                          <div className="om-sa-model-unavailable">
                            <p className="om-muted">
                              {!runtimeOnline
                                ? t('This runtime is currently offline.')
                                : !choice.agent?.installed
                                  ? t('Not installed')
                                  : t('Sign-in required')}
                            </p>
                          </div>
                        ) : (
                          <>
                            <Button
                              variant="plain"
                              type="button"
                              role="option"
                              aria-selected={isDefaultSelected}
                              data-active={isDefaultSelected || undefined}
                              className="om-sa-model-option"
                              onClick={() => onChangeSelection({
                                ...(activeRuntime ? { runtimeId: activeRuntime.id } : selection.runtimeId ? { runtimeId: selection.runtimeId } : {}),
                                engine: choice.id,
                                model: 'default',
                                reasoning: 'default',
                              })}
                            >
                              <span className="om-sa-model-option-main">
                                <span className="om-sa-model-avatar" data-engine={choice.id} aria-hidden="true">
                                  <ProviderAvatar name={choice.label} provider={providerRef} />
                                </span>
                                <span className="om-sa-model-option-text">
                                  <strong>{choice.label}</strong>
                                  <span className="om-sa-model-tag" data-tone="default">{t('Default')}</span>
                                </span>
                              </span>
                              {isDefaultSelected && <RemixIcon name="check-line" size={15} />}
                            </Button>

                            {hasCustomSelected && (
                              <Button
                                key={`${choice.id}:${selection.model}`}
                                variant="plain"
                                type="button"
                                role="option"
                                aria-selected
                                data-active
                                className="om-sa-model-option"
                                onClick={() => onChangeSelection({
                                  ...(activeRuntime ? { runtimeId: activeRuntime.id } : selection.runtimeId ? { runtimeId: selection.runtimeId } : {}),
                                  engine: choice.id,
                                  model: selection.model,
                                  reasoning: selection.reasoning,
                                })}
                              >
                                <span className="om-sa-model-option-main">
                                  <span className="om-sa-model-avatar" data-engine={choice.id} aria-hidden="true">
                                    <ModelAvatar name={selection.model} modelId={selection.model} provider={providerRef} />
                                  </span>
                                  <span className="om-sa-model-option-text">
                                    <strong>{selection.model}</strong>
                                    <span className="om-sa-model-tag" data-tone={choice.id}>{choice.label}</span>
                                  </span>
                                </span>
                                <RemixIcon name="check-line" size={15} />
                              </Button>
                            )}

                            {inspectingEngine === choice.id && !agentModels.length && (
                              <div className="om-sa-model-loading">
                                <Skeleton style={{ width: '100%', height: 32 }} />
                                <Skeleton style={{ width: '82%', height: 32 }} />
                              </div>
                            )}

                            {agentModels.map(model => {
                              const isSelected = selection.engine === choice.id && selection.model === model.id;
                              const hasReasoning = Boolean(model.reasoning?.length);
                              return (
                                <Button
                                  key={`${choice.id}:${model.id}`}
                                  variant="plain"
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  data-active={isSelected || undefined}
                                  className="om-sa-model-option"
                                  onClick={() => onChangeSelection({
                                    ...(activeRuntime ? { runtimeId: activeRuntime.id } : selection.runtimeId ? { runtimeId: selection.runtimeId } : {}),
                                    engine: choice.id,
                                    model: model.id,
                                    reasoning: 'default',
                                  })}
                                >
                                  <span className="om-sa-model-option-main">
                                    <span className="om-sa-model-avatar" data-engine={choice.id} aria-hidden="true">
                                      <ModelAvatar name={model.label} modelId={model.id} provider={providerRef} />
                                    </span>
                                    <span className="om-sa-model-option-text">
                                      <strong>{model.label}</strong>
                                      {hasReasoning ? (
                                        <span className="om-sa-model-tag" data-tone="reasoning">
                                          <RemixIcon name="sparkling-fill" size={10} />
                                        </span>
                                      ) : (
                                        <span className="om-sa-model-tag" data-tone={choice.id}>{choice.label}</span>
                                      )}
                                    </span>
                                  </span>
                                  {isSelected && <RemixIcon name="check-line" size={15} />}
                                </Button>
                              );
                            })}
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {selection.engine === 'codex' && reasoningEfforts.length > 0 && (
                    <div className="om-sa-model-reasoning">
                      <span className="om-sa-popover-label">{t('Reasoning effort')}</span>
                      <div className="om-sa-popover-pills" role="group" aria-label={t('Reasoning effort')}>
                        {(['default', ...reasoningEfforts] as const).map(level => {
                          const activeLevel = (reasoningEfforts.includes(selection.reasoning) ? selection.reasoning : 'default') === level;
                          return (
                            <Button
                              key={level}
                              variant="plain"
                              type="button"
                              className="om-sa-popover-pill"
                              aria-pressed={activeLevel}
                              data-active={activeLevel || undefined}
                              onClick={() => onChangeSelection({ ...selection, reasoning: level })}
                            >
                              {t(level === 'default' ? 'Default' : level)}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="om-sa-model-menu-foot">
                    <Button
                      variant="plain"
                      type="button"
                      className="om-sa-popover-link-row"
                      onClick={() => {
                        setModelMenuOpen(false);
                        (onOpenRuntimeSettings ?? onOpenAgentSettings)();
                      }}
                    >
                      <RemixIcon name="computer-line" size={15} />
                      <span>{t('Connected Computers')}</span>
                      <RemixIcon name="arrow-right-up-line" size={14} />
                    </Button>
                    <Button
                      variant="plain"
                      type="button"
                      className="om-sa-popover-link-row"
                      onClick={() => {
                        setModelMenuOpen(false);
                        onOpenAgentSettings();
                      }}
                    >
                      <RemixIcon name="robot-line" size={15} />
                      <span>{t('Manage Local Agents')}</span>
                      <RemixIcon name="arrow-right-up-line" size={14} />
                    </Button>
                  </div>
                </div>
              </Popover>
            </div>

            <div className="om-sa-composer-send">
              <Popover
                open={approvalMenuOpen}
                onOpenChange={setApprovalMenuOpen}
                side="top"
                align="end"
                tooltip={t('Approval mode')}
                aria-label={t('Agent settings')}
                className="om-agent-settings-popover om-sa-settings-popover"
                trigger={
                  <IconButton
                    variant="plain"
                    className="om-sa-composer-icon-btn om-sa-settings-trigger"
                    data-active={(permissionMode === 'auto' || followUpBehavior === 'queue') || undefined}
                    aria-label={t('Agent settings')}
                    disabled={sending || hasPendingApproval}
                    icon={<RemixIcon name="shield-check-line" size={17} />}
                  />
                }
              >
                <div className="om-sa-popover-body">
                  <div className="om-sa-popover-field">
                    <span className="om-sa-popover-label">{t('Approval mode')}</span>
                    <div className="om-sa-popover-segment" role="group" aria-label={t('Approval mode')}>
                      <Button
                        variant="plain"
                        type="button"
                        className="om-sa-popover-seg-btn"
                        aria-pressed={permissionMode === 'on-request'}
                        data-active={permissionMode === 'on-request' || undefined}
                        onClick={() => onChangePermissionMode('on-request')}
                      >
                        <RemixIcon name="shield-check-line" size={14} />
                        <span>{t('Ask before paid/shell actions')}</span>
                      </Button>
                      <Button
                        variant="plain"
                        type="button"
                        className="om-sa-popover-seg-btn"
                        aria-pressed={permissionMode === 'auto'}
                        data-active={permissionMode === 'auto' || undefined}
                        onClick={() => onChangePermissionMode('auto')}
                      >
                        <RemixIcon name="sparkling-line" size={14} />
                        <span>{t('Auto-approve tool runs')}</span>
                      </Button>
                    </div>
                  </div>
                  {onChangeFollowUpBehavior && (
                    <div className="om-sa-popover-field">
                      <span className="om-sa-popover-label">{t('Follow-up behavior')}</span>
                      <div className="om-sa-popover-segment" role="group" aria-label={t('Follow-up behavior')}>
                        <Button
                          variant="plain"
                          type="button"
                          className="om-sa-popover-seg-btn"
                          aria-pressed={followUpBehavior === 'steer'}
                          data-active={followUpBehavior === 'steer' || undefined}
                          onClick={() => onChangeFollowUpBehavior('steer')}
                        >
                          <RemixIcon name="arrow-go-forward-line" size={14} />
                          <span>{t('Steer current run')}</span>
                        </Button>
                        <Button
                          variant="plain"
                          type="button"
                          className="om-sa-popover-seg-btn"
                          aria-pressed={followUpBehavior === 'queue'}
                          data-active={followUpBehavior === 'queue' || undefined}
                          onClick={() => onChangeFollowUpBehavior('queue')}
                        >
                          <RemixIcon name="stack-line" size={14} />
                          <span>{t('Queue after current run')}</span>
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="om-sa-popover-links">
                    <Button
                      variant="plain"
                      type="button"
                      className="om-sa-popover-link-row"
                      onClick={() => {
                        setApprovalMenuOpen(false);
                        onOpenAgentSettings();
                      }}
                    >
                      <span className="om-sa-tone-icon" data-tone="agent" aria-hidden="true">
                        <RemixIcon name="robot-line" size={15} />
                      </span>
                      <span>{t('Manage Local Agents')}</span>
                      <RemixIcon name="arrow-right-up-line" size={14} />
                    </Button>
                    <Button
                      variant="plain"
                      type="button"
                      className="om-sa-popover-link-row"
                      onClick={() => {
                        setApprovalMenuOpen(false);
                        onOpenMcp();
                      }}
                    >
                      <span className="om-sa-tone-icon" data-tone="video" aria-hidden="true">
                        <RemixIcon name="plug-line" size={15} />
                      </span>
                      <span>{t('MCP guide')}</span>
                      <RemixIcon name="arrow-right-up-line" size={14} />
                    </Button>
                  </div>
                </div>
              </Popover>

              {isRunning && !editingQueuedId && onChangeFollowUpBehavior && (
                <Button
                  variant="plain"
                  type="button"
                  className="om-sa-followup-pill"
                  data-mode={followUpBehavior}
                  aria-label={t('Follow-up behavior')}
                  disabled={sending}
                  onClick={() => onChangeFollowUpBehavior(followUpBehavior === 'steer' ? 'queue' : 'steer')}
                >
                  <RemixIcon name={followUpBehavior === 'steer' ? 'arrow-go-forward-line' : 'stack-line'} size={13} />
                  <span>{t(followUpBehavior === 'steer' ? 'Steer' : 'Queue')}</span>
                </Button>
              )}

              {busy && (
                <IconButton
                  variant="plain"
                  className="om-sa-send-btn"
                  data-stop
                  aria-label={t('Stop')}
                  disabled={sending}
                  onClick={onStop}
                  icon={<RemixIcon name="checkbox-blank-fill" size={14} />}
                />
              )}

              {(!busy || Boolean(editingQueuedId) || (isRunning && hasDraft)) && (
                <IconButton
                  variant="plain"
                  className="om-sa-send-btn"
                  data-ready={canSubmit || undefined}
                  data-sending={(sending || scaffoldingGame) || undefined}
                  aria-label={
                    editingQueuedId
                      ? t('Save queued message')
                      : isRunning
                        ? t(followUpBehavior === 'queue' ? 'Queue message' : 'Steer')
                        : t('Send')
                  }
                  disabled={!canSubmit}
                  onClick={() => void handleSubmit()}
                  icon={
                    <RemixIcon
                      name={
                        (sending || scaffoldingGame)
                          ? 'loader-4-line'
                          : editingQueuedId
                            ? 'check-line'
                            : 'arrow-right-line'
                      }
                      size={18}
                    />
                  }
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
