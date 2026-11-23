import { Button } from 'open-design-ui/button';
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { IntegrationHost } from '../../../shared/integration';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';

const destination = {
  codex: 'Copy to your local terminal',
  claude: 'Copy to your local terminal',
  deepseek: 'Copy to your Harness configuration',
  mcp: 'Copy to your MCP settings',
};

const instructions = {
  codex: 'Run this command in a local terminal, then reload the Agent connection.',
  claude: 'Run this command in a local terminal, then reload the Agent connection.',
  deepseek: 'Merge this YAML into your Harness configuration, preserve your other plugins, then reload the session.',
  mcp: 'Merge this configuration into your client’s local MCP settings. Preserve your other servers, then reload the connection.',
};

export function McpManualConfiguration({ host, value, onCopy, children }: {
  host: Exclude<IntegrationHost, 'chatgpt'>;
  value: string;
  onCopy: (value: string) => Promise<boolean>;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const codeId = useId();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const terminal = host === 'codex' || host === 'claude';
  const preview = terminal
    ? value.replace(/ +(?:--env |-- )[^\n]*/, ' …')
    : value.split('\n', 4).join('\n');

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyConfiguration() {
    const ok = await onCopy(value);
    setCopied(ok);
    if (!ok) setExpanded(true);
  }

  return (
    <>
      <div className="om-mcp-manual-head">
        <div>
          <h2 className="om-mcp-manual-title">{t(destination[host])}</h2>
          <p className="om-mcp-manual-instructions">{t(instructions[host])}</p>
        </div>
        <Button
          type="button"
          variant="plain"
          className="om-mcp-manual-copy"
          aria-label={t('Copy configuration')}
          disabled={!value}
          onClick={() => void copyConfiguration()}
        >
          <RemixIcon name={copied ? 'check-line' : 'file-copy-line'} size={16} />
          {t(copied ? 'Copied' : 'Copy')}
        </Button>
      </div>
      <pre className="om-mcp-manual-code" id={codeId} data-preview={!expanded || undefined} tabIndex={expanded ? 0 : undefined}>
        <code>{expanded ? value : preview}</code>
      </pre>
      <div className="om-mcp-manual-footer-actions">
        <Button
          type="button"
          variant="plain"
          className="om-mcp-manual-link om-mcp-manual-expand"
          aria-expanded={expanded}
          aria-controls={codeId}
          onClick={() => setExpanded(current => !current)}
        >
          {t(expanded ? 'Hide full configuration' : 'View full configuration')}
          <RemixIcon name={expanded ? 'arrow-up-s-line' : 'arrow-down-s-line'} size={16} />
        </Button>
        <div className="om-mcp-manual-resources">{children}</div>
      </div>
    </>
  );
}
