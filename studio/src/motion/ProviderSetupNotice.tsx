import { Button } from 'open-design-ui/button';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { AccountStatus, useAccountSignIn } from './AccountSettings';
import type { ReactNode } from 'react';
import { MultimodalOfferCard, MultimodalUpgradeCard } from './MultimodalOfferCard';
import { useI18n } from '../i18n/I18n';
import type { StudioDestination } from './creativeStudios';
import { destinationTarget, reportCreativeClick, reportOfferClick, type OfferVisit } from './exploreTracking';
import { gatewayRequest } from './gatewayClient';
import { notifyProvidersChanged } from './useProviderDirectory';
import { useSubscriptionOpener } from './useSubscriptionOpener';
import { RemixIcon } from '../icons/RemixIcons';
import styles from './GenerationOffer.module.css';

export function ProviderSetupNotice({ message, children }: {
  message: string; children: ReactNode;
}) {
  return <div className="om-creation-setup om-provider-setup" role="status">
    <RemixIcon name="information-line" size={18} />
    <p className="om-muted">{message}</p>
    <div className="om-control-row">{children}</div>
  </div>;
}

export function GenerationUpgradeNotice({ destination, onError, onUpgrade, visit }: { visit?: OfferVisit; destination: StudioDestination; onError: (message: string) => void; onUpgrade: () => void }) {
  const { t } = useI18n();
  const subscription = useSubscriptionOpener(
    element => {
      onUpgrade();
      if (visit) return reportOfferClick(visit, 'upgrade', destination);
      reportCreativeClick('creative_studio', 'asset_create', element, destinationTarget(destination));
    },
    onError,
    () => { void gatewayRequest('settings/account?refresh=true').then(notifyProvidersChanged).catch((error: Error) => onError(error.message)); },
  );
  const title = destination.scene.modality === 'image'
    ? t('7 days of unlimited image generation')
    : t('Unlock popular AI models');
  return <MultimodalUpgradeCard subscription={subscription} visit={visit} title={title} buttonLabel={t('Upgrade')} />;
}

export function GenerationSignInNotice({ destination, onSignIn, visit }: { visit?: OfferVisit; destination: StudioDestination; onSignIn: () => void }) {
  const { t } = useI18n(), toast = useToast();
  const { state, busy, action } = useAccountSignIn(destination, toast.showToast);
  const retry = !state.account && state.error;
  const title = destination.scene.modality === 'image'
    ? t('7 days of unlimited image generation')
    : t('Black Friday: up to 50% off your first year');
  const signInCard = (onClick: () => void) => <MultimodalOfferCard kind="sign_in" visit={state.account ? visit : undefined} title={title} details={t('Available with Plus or higher')}>
    <Button variant="plain" className={styles.signInButton} disabled={state.account ? busy : !state.error} onClick={onClick}>
      {t(retry ? 'Retry' : 'Sign in now')}
      <RemixIcon name={retry ? 'refresh-line' : 'arrow-right-up-line'} size={12} />
    </Button>
  </MultimodalOfferCard>;
  return <>
    {state.account ? <AccountStatus account={state.account} busy={busy} showToast={toast.showToast} renderSignIn={() => signInCard(() => {
        onSignIn();
        void action('login', visit && reportOfferClick(visit, 'sign_in', destination));
      })}
      action={name => { if (name === 'login') onSignIn(); return action(name); }} />
      : signInCard(() => void state.refresh())}
    <StudioToastViewport {...toast} />
  </>;
}
