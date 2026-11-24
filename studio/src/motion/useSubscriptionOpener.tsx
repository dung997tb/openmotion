import { useEffect, useRef, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { gatewayRequest } from './gatewayClient';

// The local service opens the subscription page in the system browser, where sign-in happened, with a fresh entry
// and a one-time account intent. When no browser could be launched, Studio tries the returned link itself; the
// request has used up the click by then, so a blocked popup leaves a link that opens it on the next click.
type SubscriptionAction = 'manage_subscription' | 'view_plans';
export function useSubscriptionOpener(onClick: (action: SubscriptionAction) => string | void, onError: (message: string) => void, onReturn: () => void) {
  const { t } = useI18n(), [subscriptionUrl, setSubscriptionUrl] = useState<string>();
  const pendingCheckout = useRef<symbol | undefined>(undefined);
  function markCheckoutReturn() {
    const checkout = pendingCheckout.current = Symbol();
    return () => { if (pendingCheckout.current === checkout) pendingCheckout.current = undefined; };
  }
  useEffect(() => {
    const refreshOnReturn = () => {
      if (!pendingCheckout.current || document.visibilityState !== 'visible') return;
      pendingCheckout.current = undefined;
      onReturn();
    };
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [onReturn]);

  async function openSubscription(element: SubscriptionAction, cardEntryId?: string) {
    const entryId = cardEntryId ?? onClick(element);
    setSubscriptionUrl(undefined);
    const cancelCheckoutReturn = markCheckoutReturn();
    try {
      const { url, opened } = await gatewayRequest<{ url: string; opened: boolean }>('settings/account/subscription', 'POST', entryId ? { entryId } : {});
      if (opened) return;
      const page = window.open(url, '_blank');
      if (page) page.opener = null;
      else { cancelCheckoutReturn(); setSubscriptionUrl(url); }
    } catch {
      cancelCheckoutReturn();
      onError(t("Couldn't open your browser. Try again."));
    }
  }
  const button = (element: SubscriptionAction, primary = false) => <Button variant="ghost" className="om-button h-auto" data-primary={primary || undefined} onClick={() => void openSubscription(element)}>
    {element === 'view_plans' && <RemixIcon name="sparkling-line" size={16} />}{t(element === 'view_plans' ? 'Upgrade to Plus' : 'Manage subscription')}<RemixIcon name="external-link-line" size={15} /></Button>;
  const link = subscriptionUrl && <a className="om-button" data-primary href={subscriptionUrl} target="_blank" rel="noreferrer" onClick={() => { markCheckoutReturn(); setSubscriptionUrl(undefined); }}>{t('Continue in browser')}<RemixIcon name="external-link-line" size={15} /></a>;
  return { button, link, openSubscription };
}
