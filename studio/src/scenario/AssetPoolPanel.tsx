import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { assetMediaUrl, type AssetReference, type LibraryAsset } from '../../../shared/asset-library';
import { findDesignScenario, type DesignProject } from '../../../shared/design-project';
import type { PoolItem, PoolRef, ScenarioRun } from '../../../shared/scenario-runs';
import type { PoolKind, ScenarioDefinition, ScenarioStepDefinition } from '../../../shared/scenarios';
import { Checkbox } from '../components/ui/Checkbox';
import { FilterChip } from '../components/ui/FilterChip';
import { FieldInput } from '../components/ui/FormField';
import { Menu, MenuItem, MenuSeparator } from '../components/ui/Menu';
import { PanelEmptyState } from '../components/ui/PanelEmptyState';
import { Popover } from '../components/ui/Popover';
import { Skeleton } from '../components/ui/Skeleton';
import { designClient } from '../design/designClient';
import type { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { AssetPicker } from '../motion/AssetBrowser';
import { uploadLibraryAsset } from '../motion/assetClient';
import { useOptionalWorkspaceChrome } from '../motion/WorkspaceChromeContext';
import { downloadText } from './scenarioClient';
import { PoolItemPreviewDialog, PoolThumb, resolvePoolTextContent } from './PoolItemPreview';
import { isScenarioConflictError } from './steps/stepUtils';

export type PoolPickRequest = {
  slot: string;
  kinds: PoolKind[];
  max?: number;
  selected: string[];
};

export type AssetPoolPanelProps = {
  scenario: ScenarioDefinition;
  run: ScenarioRun | null;
  currentStep: ScenarioStepDefinition;
  items: PoolItem[];
  highlightedIds: ReadonlySet<string>;
  open: boolean;
  onOpenChange(open: boolean): void;
  pickRequest: PoolPickRequest | null;
  onConfirmPick(ids: string[]): void;
  onCancelPick(): void;
  onAddItems(
    items: { ref: PoolRef; label?: string; tags?: string[]; stepId?: string | null; source: PoolItem['source'] }[],
  ): Promise<string[]>;
  onUpdateItem(
    poolItemId: string,
    changes: { label?: string; tags?: string[]; pinned?: boolean },
  ): Promise<void>;
  onRemoveItem(poolItemId: string): Promise<void>;
  onUseInCurrentStep(item: PoolItem): Promise<void>;
  onOpenDesignProject(id: string): void;
  onOpenMotionProject(id: string): Promise<boolean>;
  toast: Pick<ReturnType<typeof useToast>, 'showToast'>;
};

type KindFilter = 'all' | PoolKind;

const KIND_FILTERS: readonly { id: KindFilter; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: 'stack-line' },
  { id: 'image', label: 'Images', icon: 'image-line' },
  { id: 'video', label: 'Video', icon: 'movie-line' },
  { id: 'audio', label: 'Audio', icon: 'music-2-line' },
  { id: 'page', label: 'Pages', icon: 'layout-line' },
  { id: 'motion', label: 'Motion', icon: 'film-line' },
  { id: 'text', label: 'Text', icon: 'file-text-line' },
];

const KIND_BADGE_LABELS: Record<PoolKind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  page: 'Page',
  motion: 'Motion',
  text: 'Text',
};

const MANUAL_STEP_KEY = '__manual__';

type LayoutMode = 'docked' | 'drawer' | 'sheet';

function readLayoutMode(): LayoutMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'docked';
  }
  if (window.matchMedia('(max-width: 767px)').matches) return 'sheet';
  if (window.matchMedia('(max-width: 1099px)').matches) return 'drawer';
  return 'docked';
}

function usePoolLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(readLayoutMode);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const sheetMq = window.matchMedia('(max-width: 767px)');
    const drawerMq = window.matchMedia('(max-width: 1099px)');
    const update = () => {
      if (sheetMq.matches) setMode('sheet');
      else if (drawerMq.matches) setMode('drawer');
      else setMode('docked');
    };
    update();
    sheetMq.addEventListener?.('change', update);
    drawerMq.addEventListener?.('change', update);
    return () => {
      sheetMq.removeEventListener?.('change', update);
      drawerMq.removeEventListener?.('change', update);
    };
  }, []);

  return mode;
}

export function AssetPoolPanel({
  scenario,
  run,
  currentStep,
  items,
  highlightedIds,
  open,
  onOpenChange,
  pickRequest,
  onConfirmPick,
  onCancelPick,
  onAddItems,
  onUpdateItem,
  onRemoveItem,
  onUseInCurrentStep,
  onOpenDesignProject,
  onOpenMotionProject,
  toast,
}: AssetPoolPanelProps) {
  const { t } = useI18n();
  const chrome = useOptionalWorkspaceChrome();
  const layoutMode = usePoolLayoutMode();

  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [stepFilters, setStepFilters] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetPickerBusy, setAssetPickerBusy] = useState(false);
  const [designPickerOpen, setDesignPickerOpen] = useState(false);
  const [designProjects, setDesignProjects] = useState<DesignProject[]>([]);
  const [designLoading, setDesignLoading] = useState(false);
  const [designError, setDesignError] = useState<string | null>(null);
  const [motionPickerOpen, setMotionPickerOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<PoolItem | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [draftPickIds, setDraftPickIds] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipRenameBlurRef = useRef(false);

  // Sync draft selection when pick mode activates or changes.
  useEffect(() => {
    if (pickRequest) {
      setDraftPickIds(pickRequest.selected);
    } else {
      setDraftPickIds([]);
    }
  }, [pickRequest]);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  const loadDesignProjects = useCallback(async () => {
    setDesignLoading(true);
    setDesignError(null);
    try {
      const res = await designClient.listProjects();
      setDesignProjects((res.projects ?? []).filter(project => !project.trashedAt));
    } catch (err) {
      setDesignError(err instanceof Error ? err.message : t('Could not load Design projects'));
    } finally {
      setDesignLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (designPickerOpen) {
      void loadDesignProjects();
    }
  }, [designPickerOpen, loadDesignProjects]);

  const stepTitleMap = useMemo(
    () => new Map(scenario.steps.map(step => [step.id, step.title])),
    [scenario.steps],
  );

  // Items eligible under pickRequest (if active) + step filter.
  const stepFilteredItems = useMemo(() => {
    return items.filter(item => {
      if (pickRequest && !pickRequest.kinds.includes(item.kind)) {
        return false;
      }
      if (stepFilters.length === 0) return true;
      const key = item.stepId ?? MANUAL_STEP_KEY;
      return stepFilters.includes(key);
    });
  }, [items, pickRequest, stepFilters]);

  const kindCounts = useMemo(() => {
    const counts: Record<KindFilter, number> = {
      all: stepFilteredItems.length,
      image: 0,
      video: 0,
      audio: 0,
      page: 0,
      motion: 0,
      text: 0,
    };
    for (const item of stepFilteredItems) {
      counts[item.kind] += 1;
    }
    return counts;
  }, [stepFilteredItems]);

  const stepCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (pickRequest && !pickRequest.kinds.includes(item.kind)) continue;
      if (kindFilter !== 'all' && item.kind !== kindFilter) continue;
      const key = item.stepId ?? MANUAL_STEP_KEY;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [items, kindFilter, pickRequest]);

  const visibleItems = useMemo(() => {
    const matched = stepFilteredItems.filter(item =>
      kindFilter === 'all' ? true : item.kind === kindFilter,
    );
    return [...matched].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.addedAt - a.addedAt;
    });
  }, [kindFilter, stepFilteredItems]);

  const setStepFilter = (key: string, checked: boolean) => {
    setStepFilters(prev => {
      if (checked) return prev.includes(key) ? prev : [...prev, key];
      return prev.filter(item => item !== key);
    });
  };

  const toggleStepFilter = (key: string) => {
    setStepFilters(prev =>
      prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key],
    );
  };

  const clearAllFilters = () => {
    setKindFilter('all');
    setStepFilters([]);
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    setUploading(true);
    try {
      const toAdd: { ref: PoolRef; label: string; stepId: null; source: 'upload' }[] = [];
      let failedCount = 0;

      for (const file of files) {
        try {
          const uploaded = await uploadLibraryAsset(file);
          toAdd.push({
            ref: {
              type: 'asset',
              assetId: uploaded.id,
              versionId: uploaded.currentVersionId,
            },
            label: uploaded.name || file.name,
            stepId: null,
            source: 'upload',
          });
        } catch {
          failedCount += 1;
        }
      }

      if (toAdd.length > 0) {
        await onAddItems(toAdd);
        toast.showToast(
          t('Added {count} file(s) to workflow pool', { count: toAdd.length }),
          'info',
          'feedback',
        );
      }
      if (failedCount > 0) {
        toast.showToast(
          t('{count} file(s) could not be uploaded', { count: failedCount }),
          'error',
          'feedback',
        );
      }
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not add uploaded files to pool'),
          'error',
          'feedback',
        );
      }
    } finally {
      setUploading(false);
    }
  };

  const handleWorkspaceAssetPick = async (reference: AssetReference, asset: LibraryAsset) => {
    setAssetPickerBusy(true);
    try {
      await onAddItems([
        {
          ref: {
            type: 'asset',
            assetId: reference.assetId,
            versionId: reference.versionId,
          },
          label: asset.name,
          stepId: null,
          source: 'workspace',
        },
      ]);
      setAssetPickerOpen(false);
      toast.showToast(t('Added to workflow pool'), 'info', 'feedback');
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not add asset to pool'),
          'error',
          'feedback',
        );
      }
    } finally {
      setAssetPickerBusy(false);
    }
  };

  const handleAddDesignProject = async (project: DesignProject) => {
    try {
      await onAddItems([
        {
          ref: {
            type: 'design',
            projectId: project.id,
            versionId: project.versionId,
            revision: project.revision,
          },
          label: project.title,
          stepId: null,
          source: 'workspace',
        },
      ]);
      setDesignPickerOpen(false);
      toast.showToast(t('Added Design project to pool'), 'info', 'feedback');
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not add Design project'),
          'error',
          'feedback',
        );
      }
    }
  };

  const handleAddMotionProject = async (project: { id: string; title: string }) => {
    try {
      await onAddItems([
        {
          ref: {
            type: 'motion',
            projectId: project.id,
            sessionId: null,
          },
          label: project.title,
          stepId: null,
          source: 'workspace',
        },
      ]);
      setMotionPickerOpen(false);
      toast.showToast(t('Added Motion project to pool'), 'info', 'feedback');
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not add Motion project'),
          'error',
          'feedback',
        );
      }
    }
  };

  const handleDownloadItem = async (item: PoolItem) => {
    try {
      if (item.ref.type === 'asset') {
        const href = `${assetMediaUrl(item.ref.assetId, item.ref.versionId)}?download`;
        const link = document.createElement('a');
        link.href = href;
        link.download = item.label;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else if (item.ref.type === 'design') {
        await designClient.downloadExport(item.ref.projectId, {
          format: 'zip',
          versionId: item.ref.versionId,
        });
      } else if (item.ref.type === 'text') {
        const text = resolvePoolTextContent(item, run);
        const safeName = item.label.toLowerCase().replace(/[^a-z0-9-_]+/g, '-') || 'note';
        downloadText(`${safeName}.txt`, text);
      }
    } catch (err) {
      toast.showToast(
        err instanceof Error ? err.message : t('Could not download asset'),
        'error',
        'feedback',
      );
    }
  };

  const handleOpenItem = (item: PoolItem) => {
    if (item.ref.type === 'design') {
      onOpenDesignProject(item.ref.projectId);
    } else if (item.ref.type === 'motion') {
      void onOpenMotionProject(item.ref.projectId);
    } else if (item.ref.type === 'asset') {
      const url = `/?page=assets&asset=${encodeURIComponent(item.ref.assetId)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleCopyReference = async (item: PoolItem) => {
    const payload = JSON.stringify(
      {
        poolItemId: item.id,
        kind: item.kind,
        label: item.label,
        ref: item.ref,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(payload);
      toast.showToast(t('Copied asset reference'), 'info', 'feedback');
    } catch {
      toast.showToast(t('Could not copy reference'), 'error', 'feedback');
    }
  };

  const handleRemoveItem = async (item: PoolItem) => {
    try {
      await onRemoveItem(item.id);
      toast.showToast(
        t('Removed from workflow. Original workspace asset was kept.'),
        'info',
        'feedback',
      );
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not remove item'),
          'error',
          'feedback',
        );
      }
    }
  };

  const handleTogglePin = async (item: PoolItem) => {
    try {
      await onUpdateItem(item.id, { pinned: !item.pinned });
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not update asset'),
          'error',
          'feedback',
        );
      }
    }
  };

  const beginRename = (item: PoolItem) => {
    skipRenameBlurRef.current = false;
    setRenamingId(item.id);
    setRenameDraft(item.label);
  };

  const commitRename = async (item: PoolItem) => {
    if (skipRenameBlurRef.current) {
      skipRenameBlurRef.current = false;
      return;
    }
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === item.label) return;
    try {
      await onUpdateItem(item.id, { label: trimmed });
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not rename asset'),
          'error',
          'feedback',
        );
      }
    }
  };

  const togglePickItem = (itemId: string) => {
    if (!pickRequest) return;
    setDraftPickIds(prev => {
      if (prev.includes(itemId)) {
        return prev.filter(id => id !== itemId);
      }
      if (pickRequest.max === 1) {
        return [itemId];
      }
      if (pickRequest.max && prev.length >= pickRequest.max) {
        return prev;
      }
      return [...prev, itemId];
    });
  };

  const motionProjects = useMemo(
    () => (chrome?.workspace.projects ?? []).filter(project => !project.trashedAt),
    [chrome?.workspace.projects],
  );

  const hasActiveFilters = kindFilter !== 'all' || stepFilters.length > 0;

  const panelBody = (
    <div className="om-scenario-pool-inner">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        className="om-scenario-hidden-file-input"
        aria-label={t('Upload files to workflow pool')}
        onChange={event => void handleFileUpload(event)}
      />

      <header className="om-scenario-pool-header">
        <div className="om-scenario-pool-title-group">
          <RemixIcon name="stack-line" size={16} />
          <h2 className="om-scenario-pool-title">{t('Shared asset pool')}</h2>
          <span className="om-badge">{items.length}</span>
        </div>
        <div className="om-scenario-pool-header-actions">
          <Menu
            align="end"
            aria-label={t('Add to shared asset pool')}
            trigger={
              <Button
                variant="secondary"
                size="sm"
                type="button"
                loading={uploading}
                icon={<RemixIcon name="add-line" size={14} />}
              >
                {t('Add')}
              </Button>
            }
          >
            <MenuItem
              icon={<RemixIcon name="upload-2-line" size={14} />}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('Upload files…')}
            </MenuItem>
            <MenuItem
              icon={<RemixIcon name="folder-open-line" size={14} />}
              onClick={() => setAssetPickerOpen(true)}
            >
              {t('From workspace assets…')}
            </MenuItem>
            <MenuItem
              icon={<RemixIcon name="layout-line" size={14} />}
              onClick={() => setDesignPickerOpen(true)}
            >
              {t('From a Design project…')}
            </MenuItem>
            <MenuItem
              icon={<RemixIcon name="movie-line" size={14} />}
              onClick={() => setMotionPickerOpen(true)}
            >
              {t('From a Motion project…')}
            </MenuItem>
          </Menu>

          {layoutMode !== 'docked' && (
            <IconButton
              variant="ghost"
              size="sm"
              type="button"
              aria-label={t('Close asset pool')}
              onClick={() => onOpenChange(false)}
              icon={<RemixIcon name="close-line" size={16} />}
            />
          )}
        </div>
      </header>

      {pickRequest && (
        <div className="om-scenario-pick-banner" role="region" aria-label={t('Pick from pool')}>
          <div className="om-scenario-pick-banner-copy">
            <strong>{t('Select assets for {slot}', { slot: pickRequest.slot })}</strong>
            <span className="om-muted">
              {pickRequest.max
                ? t('Choose up to {max} matching item(s).', { max: pickRequest.max })
                : t('Choose one or more matching items.')}
            </span>
          </div>
          <div className="om-scenario-pick-actions">
            <Button
              variant="primary"
              size="sm"
              type="button"
              onClick={() => onConfirmPick(draftPickIds)}
            >
              {t('Use {count} selected', { count: draftPickIds.length })}
            </Button>
            <Button variant="ghost" size="sm" type="button" onClick={onCancelPick}>
              {t('Cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="om-scenario-pool-filters">
        <div className="om-scenario-kind-chips" role="group" aria-label={t('Filter by asset kind')}>
          {KIND_FILTERS.map(filter => {
            const disallowedInPick =
              pickRequest !== null &&
              filter.id !== 'all' &&
              !pickRequest.kinds.includes(filter.id);
            if (disallowedInPick) return null;
            return (
              <FilterChip
                key={filter.id}
                active={kindFilter === filter.id}
                onClick={() => setKindFilter(filter.id)}
              >
                <span>{t(filter.label)}</span>
                <span className="om-scenario-chip-count">{kindCounts[filter.id]}</span>
              </FilterChip>
            );
          })}
        </div>

        <div className="om-scenario-step-filter-row">
          <Popover
            align="end"
            aria-label={t('Filter by step')}
            className="om-scenario-step-popover"
            trigger={
              <Button
                variant="ghost"
                size="sm"
                type="button"
                icon={<RemixIcon name="filter-3-line" size={14} />}
              >
                <span>{t('Step filter')}</span>
                {stepFilters.length > 0 && (
                  <span className="om-badge" data-active="true">
                    {stepFilters.length}
                  </span>
                )}
              </Button>
            }
          >
            <div className="om-scenario-popover-body">
              <div className="om-scenario-popover-header">
                <strong>{t('Filter by source step')}</strong>
                <span className="om-muted">
                  {t('{count} matching', { count: visibleItems.length })}
                </span>
              </div>
              <div className="om-scenario-popover-list">
                {scenario.steps.map(step => {
                  const checked = stepFilters.includes(step.id);
                  const count = stepCounts.get(step.id) ?? 0;
                  return (
                    <div key={step.id} className="om-scenario-popover-option">
                      <Checkbox
                        aria-label={t(step.title)}
                        checked={checked}
                        onCheckedChange={next => setStepFilter(step.id, Boolean(next))}
                      />
                      <span
                        className="om-scenario-popover-option-label"
                        onClick={() => setStepFilter(step.id, !checked)}
                      >
                        {t(step.title)}
                      </span>
                      <span className="om-scenario-chip-count">{count}</span>
                    </div>
                  );
                })}
                <div className="om-scenario-popover-option">
                  <Checkbox
                    aria-label={t('Added manually')}
                    checked={stepFilters.includes(MANUAL_STEP_KEY)}
                    onCheckedChange={next => setStepFilter(MANUAL_STEP_KEY, Boolean(next))}
                  />
                  <span
                    className="om-scenario-popover-option-label"
                    onClick={() => setStepFilter(MANUAL_STEP_KEY, !stepFilters.includes(MANUAL_STEP_KEY))}
                  >
                    {t('Added manually')}
                  </span>
                  <span className="om-scenario-chip-count">
                    {stepCounts.get(MANUAL_STEP_KEY) ?? 0}
                  </span>
                </div>
              </div>
              <div className="om-scenario-popover-footer">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={stepFilters.length === 0}
                  onClick={() => setStepFilters([])}
                >
                  {t('Clear current')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={!hasActiveFilters}
                  onClick={clearAllFilters}
                >
                  {t('Clear all')}
                </Button>
              </div>
            </div>
          </Popover>
        </div>

        {hasActiveFilters && (
          <div className="om-scenario-active-filters" aria-label={t('Active filters')}>
            {kindFilter !== 'all' && (
              <Button
                variant="plain"
                type="button"
                className="om-badge om-scenario-filter-chip"
                onClick={() => setKindFilter('all')}
              >
                <span>{t(KIND_BADGE_LABELS[kindFilter])}</span>
                <RemixIcon name="close-line" size={12} />
              </Button>
            )}
            {stepFilters.map(key => {
              const label =
                key === MANUAL_STEP_KEY
                  ? t('Added manually')
                  : t(stepTitleMap.get(key) ?? key);
              return (
                <Button
                  key={key}
                  variant="plain"
                  type="button"
                  className="om-badge om-scenario-filter-chip"
                  onClick={() => toggleStepFilter(key)}
                >
                  <span>{label}</span>
                  <RemixIcon name="close-line" size={12} />
                </Button>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={clearAllFilters}
            >
              {t('Clear all')}
            </Button>
          </div>
        )}
      </div>

      <div className="om-scenario-pool-scroll">
        {items.length === 0 ? (
          <div className="om-scenario-pool-empty">
            <PanelEmptyState
              icon="stack-line"
              message={t('Shared asset pool is empty')}
              description={t('Add files, import workspace assets, or generate in any step. Everything you make lands here.')}
            />
            <div className="om-scenario-pool-empty-actions">
              <Button
                variant="primary"
                size="sm"
                type="button"
                icon={<RemixIcon name="upload-2-line" size={14} />}
                onClick={() => fileInputRef.current?.click()}
              >
                {t('Upload files')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                icon={<RemixIcon name="folder-open-line" size={14} />}
                onClick={() => setAssetPickerOpen(true)}
              >
                {t('Pick from workspace')}
              </Button>
            </div>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="om-scenario-pool-empty">
            <PanelEmptyState
              icon="filter-3-line"
              message={t('No matching pool items')}
              description={t('Try clearing filters or add a matching asset.')}
            />
            {hasActiveFilters && (
              <div className="om-scenario-pool-empty-actions">
                <Button variant="secondary" size="sm" type="button" onClick={clearAllFilters}>
                  {t('Clear all')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="om-scenario-pool-grid">
            {visibleItems.map(item => {
              const isHighlighted = highlightedIds.has(item.id);
              const isSelectedForPick = draftPickIds.includes(item.id);
              const pickLimitReached =
                pickRequest !== null &&
                pickRequest.max !== undefined &&
                pickRequest.max > 1 &&
                !isSelectedForPick &&
                draftPickIds.length >= pickRequest.max;
              const canUse = currentStep.accepts.includes(item.kind);
              const stepTitle = item.stepId ? stepTitleMap.get(item.stepId) : null;
              const sourceBadge = stepTitle
                ? t('From {step}', { step: t(stepTitle) })
                : item.source === 'upload'
                  ? t('Upload')
                  : item.source === 'workspace'
                    ? t('Workspace')
                    : item.source === 'agent'
                      ? t('Agent')
                      : t('Generated');

              return (
                <article
                  key={item.id}
                  className="om-scenario-pool-card"
                  data-pool-item={item.id}
                  data-kind={item.kind}
                  data-pinned={item.pinned || undefined}
                  data-highlighted={isHighlighted || undefined}
                  data-selected={isSelectedForPick || undefined}
                  draggable={!pickRequest}
                  onDragStart={event => {
                    if (pickRequest) return;
                    event.dataTransfer.setData('application/x-om-pool-item', item.id);
                    event.dataTransfer.effectAllowed = 'copyLink';
                  }}
                >
                  <div className="om-scenario-pool-card-media">
                    <PoolThumb item={item} run={run} size="md" hoverPreview />
                    {pickRequest && (
                      <div className="om-scenario-pool-card-check">
                        <Checkbox
                          aria-label={t('Select {label}', { label: item.label })}
                          checked={isSelectedForPick}
                          disabled={pickLimitReached}
                          onCheckedChange={() => togglePickItem(item.id)}
                        />
                      </div>
                    )}
                  </div>

                  <div className="om-scenario-pool-card-body">
                    <div className="om-scenario-pool-card-top">
                      {renamingId === item.id ? (
                        <FieldInput
                          ref={renameInputRef}
                          density="compact"
                          className="om-scenario-pool-rename"
                          aria-label={t('Rename asset')}
                          value={renameDraft}
                          maxLength={200}
                          onChange={event => setRenameDraft(event.target.value)}
                          onBlur={() => void commitRename(item)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void commitRename(item);
                            } else if (event.key === 'Escape') {
                              event.preventDefault();
                              skipRenameBlurRef.current = true;
                              setRenamingId(null);
                            }
                          }}
                        />
                      ) : (
                        <strong className="om-scenario-pool-card-label" title={item.label}>
                          {item.label}
                        </strong>
                      )}

                      <div className="om-scenario-pool-card-controls">
                        <IconButton
                          variant="ghost"
                          size="sm"
                          type="button"
                          className="om-scenario-pin-button"
                          aria-label={t(item.pinned ? 'Unpin asset' : 'Pin asset')}
                          aria-pressed={item.pinned}
                          onClick={() => void handleTogglePin(item)}
                          icon={
                            <RemixIcon
                              name={item.pinned ? 'sparkling-fill' : 'sparkling-line'}
                              size={14}
                            />
                          }
                        />

                        <Menu
                          align="end"
                          aria-label={t('Actions for {label}', { label: item.label })}
                          trigger={
                            <IconButton
                              variant="ghost"
                              size="sm"
                              type="button"
                              aria-label={t('Asset actions')}
                              icon={<RemixIcon name="more-line" size={14} />}
                            />
                          }
                        >
                          <MenuItem
                            icon={<RemixIcon name="check-line" size={14} />}
                            disabled={!canUse}
                            onClick={() => void onUseInCurrentStep(item)}
                          >
                            {t('Use in current step')}
                          </MenuItem>
                          <MenuItem
                            icon={<RemixIcon name="eye-line" size={14} />}
                            onClick={() => setPreviewItem(item)}
                          >
                            {t('Preview')}
                          </MenuItem>
                          <MenuItem
                            icon={<RemixIcon name="download-2-line" size={14} />}
                            disabled={item.ref.type === 'motion'}
                            onClick={() => void handleDownloadItem(item)}
                          >
                            {t('Download')}
                          </MenuItem>
                          <MenuItem
                            icon={<RemixIcon name="external-link-line" size={14} />}
                            disabled={item.ref.type === 'text'}
                            onClick={() => handleOpenItem(item)}
                          >
                            {t('Open')}
                          </MenuItem>
                          <MenuItem
                            icon={<RemixIcon name="file-copy-line" size={14} />}
                            onClick={() => void handleCopyReference(item)}
                          >
                            {t('Copy reference')}
                          </MenuItem>
                          <MenuItem
                            icon={<RemixIcon name="edit-line" size={14} />}
                            onClick={() => beginRename(item)}
                          >
                            {t('Rename')}
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem
                            icon={<RemixIcon name="delete-bin-line" size={14} />}
                            tone="danger"
                            onClick={() => void handleRemoveItem(item)}
                          >
                            {t('Remove from workflow')}
                          </MenuItem>
                        </Menu>
                      </div>
                    </div>

                    <div className="om-scenario-pool-card-badges">
                      <span className="om-badge">{t(KIND_BADGE_LABELS[item.kind])}</span>
                      <span className="om-badge">{sourceBadge}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const dialogs = (
    <>
      {assetPickerOpen && (
        <AssetPicker
          title="Add from workspace assets"
          confirmLabel="Add to workflow pool"
          busy={assetPickerBusy}
          onClose={() => setAssetPickerOpen(false)}
          onPick={(reference, asset) => void handleWorkspaceAssetPick(reference, asset)}
        />
      )}

      {designPickerOpen && (
        <Dialog.Root open onOpenChange={next => { if (!next) setDesignPickerOpen(false); }}>
          <Dialog.Portal>
            <Dialog.Backdrop className="hf-overlay-backdrop om-scenario-backdrop" />
            <Dialog.Popup
              data-feedback-modal=""
              className="om-dialog om-scenario-picker-dialog"
              onKeyDown={event => event.stopPropagation()}
            >
              <header className="om-scenario-preview-header">
                <Dialog.Title className="om-subtitle">{t('Add from a Design project')}</Dialog.Title>
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label={t('Close')}
                  onClick={() => setDesignPickerOpen(false)}
                  icon={<RemixIcon name="close-line" size={18} />}
                />
              </header>
              <div className="om-scenario-picker-list">
                {designLoading ? (
                  <div className="om-scenario-runs-skeleton">
                    <Skeleton className="om-scenario-run-skeleton-row" />
                    <Skeleton className="om-scenario-run-skeleton-row" />
                  </div>
                ) : designError ? (
                  <div className="om-scenario-runs-error" role="alert">
                    <RemixIcon name="error-warning-line" size={18} />
                    <span>{designError}</span>
                    <Button variant="secondary" size="sm" onClick={() => void loadDesignProjects()}>
                      {t('Retry')}
                    </Button>
                  </div>
                ) : designProjects.length === 0 ? (
                  <PanelEmptyState
                    icon="layout-line"
                    message={t('No Design projects yet')}
                    description={t('Create a web page in a workflow step or in Design Studio first.')}
                  />
                ) : (
                  designProjects.map(project => (
                    <Button
                      key={project.id}
                      variant="plain"
                      type="button"
                      className="om-scenario-picker-row"
                      onClick={() => void handleAddDesignProject(project)}
                    >
                      <RemixIcon name="layout-line" size={16} />
                      <span className="om-scenario-picker-row-title">{project.title}</span>
                      <span className="om-badge">
                        {t(findDesignScenario(project.scenario)?.label ?? project.scenario)}
                      </span>
                    </Button>
                  ))
                )}
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {motionPickerOpen && (
        <Dialog.Root open onOpenChange={next => { if (!next) setMotionPickerOpen(false); }}>
          <Dialog.Portal>
            <Dialog.Backdrop className="hf-overlay-backdrop om-scenario-backdrop" />
            <Dialog.Popup
              data-feedback-modal=""
              className="om-dialog om-scenario-picker-dialog"
              onKeyDown={event => event.stopPropagation()}
            >
              <header className="om-scenario-preview-header">
                <Dialog.Title className="om-subtitle">{t('Add from a Motion project')}</Dialog.Title>
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label={t('Close')}
                  onClick={() => setMotionPickerOpen(false)}
                  icon={<RemixIcon name="close-line" size={18} />}
                />
              </header>
              <div className="om-scenario-picker-list">
                {motionProjects.length === 0 ? (
                  <PanelEmptyState
                    icon="movie-line"
                    message={t('No Motion projects available')}
                    description={t('Create a Motion project from the video step or Motion Studio first.')}
                  />
                ) : (
                  motionProjects.map(project => (
                    <Button
                      key={project.id}
                      variant="plain"
                      type="button"
                      className="om-scenario-picker-row"
                      onClick={() => void handleAddMotionProject(project)}
                    >
                      <RemixIcon name="film-line" size={16} />
                      <span className="om-scenario-picker-row-title">{project.title}</span>
                    </Button>
                  ))
                )}
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      <PoolItemPreviewDialog
        item={previewItem}
        run={run}
        canUseInCurrentStep={Boolean(previewItem && currentStep.accepts.includes(previewItem.kind))}
        onClose={() => setPreviewItem(null)}
        onUseInCurrentStep={item => void onUseInCurrentStep(item)}
        onDownload={item => void handleDownloadItem(item)}
        onOpen={handleOpenItem}
        onCopyReference={item => void handleCopyReference(item)}
      />
    </>
  );

  if (layoutMode === 'sheet') {
    return (
      <>
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
          <Dialog.Portal>
            <Dialog.Backdrop className="hf-overlay-backdrop om-scenario-backdrop" />
            <Dialog.Popup
              id="om-scenario-pool"
              data-feedback-modal=""
              className="om-scenario-pool om-scenario-pool--sheet"
              onKeyDown={event => event.stopPropagation()}
            >
              {panelBody}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
        {dialogs}
      </>
    );
  }

  if (layoutMode === 'drawer') {
    return (
      <>
        {open && (
          <div
            className="om-scenario-drawer-scrim"
            aria-hidden="true"
            onClick={() => onOpenChange(false)}
          />
        )}
        <aside
          id="om-scenario-pool"
          aria-label={t('Shared asset pool')}
          className="om-scenario-pool om-scenario-pool--drawer"
          data-open={open ? 'true' : 'false'}
          hidden={!open}
        >
          {panelBody}
        </aside>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <aside
        id="om-scenario-pool"
        aria-label={t('Shared asset pool')}
        className="om-scenario-pool om-scenario-pool--docked"
      >
        {panelBody}
      </aside>
      {dialogs}
    </>
  );
}
