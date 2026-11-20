import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useState, type DragEvent } from 'react';
import { assetMediaUrl } from '../../../../shared/asset-library';
import type { PoolItem } from '../../../../shared/scenario-runs';
import type { PoolKind } from '../../../../shared/scenarios';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import type { StepProps } from '../stepContract';
import { extractErrorMessage, POOL_DRAG_MIME, poolKindIcon } from './stepUtils';

export type BindingSlotProps = {
  slot: string;
  label: string;
  hint?: string;
  kinds: PoolKind[];
  max?: number;
  required?: boolean;
  stepId: string;
  boundIds: string[];
  pool: StepProps['pool'];
  api: StepProps['api'];
  toast: StepProps['toast'];
  disabled?: boolean;
  onChanged?: (nextIds: string[]) => void;
};

function SlotThumb({ item }: { item: PoolItem }) {
  const [failed, setFailed] = useState(false);

  if (item.ref.type === 'asset' && item.kind === 'image' && !failed) {
    return (
      <img
        className="om-step-slot-thumb"
        src={assetMediaUrl(item.ref.assetId, item.ref.versionId)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  if (item.ref.type === 'asset' && item.kind === 'video' && !failed) {
    return (
      <video
        className="om-step-slot-thumb"
        src={assetMediaUrl(item.ref.assetId, item.ref.versionId)}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="om-step-slot-icon" aria-hidden="true">
      <RemixIcon name={poolKindIcon(item.kind)} size={14} />
    </span>
  );
}

function parseDraggedPoolId(data: string): string | null {
  const trimmed = data.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { poolItemId?: unknown; id?: unknown };
      if (typeof parsed.poolItemId === 'string' && parsed.poolItemId) return parsed.poolItemId;
      if (typeof parsed.id === 'string' && parsed.id) return parsed.id;
    } catch {
      return null;
    }
  }
  return trimmed;
}

export function BindingSlot({
  slot,
  label,
  hint,
  kinds,
  max,
  required = false,
  stepId,
  boundIds,
  pool,
  api,
  toast,
  disabled = false,
  onChanged,
}: BindingSlotProps) {
  const { t } = useI18n();
  const [dragOver, setDragOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const busy = disabled || picking || api.busy.has(`bind:${slot}`);

  const commit = async (nextIds: string[]) => {
    const capped = max !== undefined ? nextIds.slice(0, max) : nextIds;
    try {
      await api.mutate(`bind:${slot}`, 'update_step', {
        stepId,
        bindings: { [slot]: capped },
      });
      onChanged?.(capped);
    } catch (error) {
      toast.showToast(extractErrorMessage(error, t('Could not update step inputs.')), 'error', 'feedback');
    }
  };

  const handlePick = async () => {
    if (busy) return;
    setPicking(true);
    try {
      const picked = await pool.requestPick({
        slot,
        kinds,
        ...(max !== undefined ? { max } : {}),
        selected: boundIds,
      });
      if (picked !== null) {
        await commit(picked);
      }
    } finally {
      setPicking(false);
    }
  };

  const handleRemove = (id: string) => {
    if (busy) return;
    void commit(boundIds.filter(existing => existing !== id));
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (busy) return;
    const types = Array.from(event.dataTransfer?.types ?? []);
    if (!types.includes(POOL_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragOver(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    setDragOver(false);
    if (busy) return;
    const raw = event.dataTransfer?.getData(POOL_DRAG_MIME);
    if (!raw) return;
    event.preventDefault();
    const id = parseDraggedPoolId(raw);
    if (!id) return;
    const item = pool.byId.get(id);
    if (!item) {
      toast.showToast(t('That asset is no longer in the pool.'), 'error', 'feedback');
      return;
    }
    if (!kinds.includes(item.kind)) {
      toast.showToast(t('This slot accepts {kinds} only.', { kinds: kinds.join(', ') }), 'error', 'feedback');
      return;
    }
    if (boundIds.includes(item.id)) return;
    if (max === 1) {
      void commit([item.id]);
      return;
    }
    if (max !== undefined && boundIds.length >= max) {
      toast.showToast(t('This slot accepts at most {max} items.', { max }), 'error', 'feedback');
      return;
    }
    void commit([...boundIds, item.id]);
  };

  const resolvedItems = boundIds
    .map(id => ({ id, item: pool.byId.get(id) ?? null }))
    .filter(entry => entry.item !== null);

  return (
    <div
      className="om-step-binding-slot"
      data-slot={slot}
      data-drag-over={dragOver ? 'true' : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="om-step-binding-head">
        <div className="om-step-binding-meta">
          <span className="om-step-binding-label">
            {label}
            {required && <span className="om-step-required" aria-hidden="true">*</span>}
          </span>
          {max !== undefined && (
            <span className="om-step-count-badge">
              {resolvedItems.length}/{max}
            </span>
          )}
          {hint && <span className="om-step-muted">{hint}</span>}
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<RemixIcon name="stack-line" size={14} />}
          loading={picking}
          disabled={busy}
          onClick={() => void handlePick()}
        >
          {t('Pick from pool')}
        </Button>
      </div>

      {resolvedItems.length > 0 ? (
        <div className="om-step-chip-list">
          {resolvedItems.map(({ id, item }) => (
            <span key={id} className="om-step-bound-chip" data-pool-item-id={id}>
              <SlotThumb item={item!} />
              <span className="om-step-bound-chip-label">{item!.label}</span>
              <IconButton
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={t('Remove {label}', { label: item!.label })}
                icon={<RemixIcon name="close-line" size={12} />}
                onClick={() => handleRemove(id)}
              />
            </span>
          ))}
        </div>
      ) : (
        <p className="om-step-slot-empty">
          {required
            ? t('Drop from the asset pool or pick an input to continue.')
            : t('Optional. Drag from the asset pool or pick an input.')}
        </p>
      )}
    </div>
  );
}
