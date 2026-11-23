import { IconGlyph } from '../../../packages/design-system/react/IconGlyph';
import { RemixIcon } from '../icons/RemixIcons';
import type { mcpClients } from './mcpClients';
import { ProviderAvatar } from './settingsPrimitives';

export function McpClientAvatar({ client, inDock = false }: { client: typeof mcpClients[number]; inDock?: boolean }) {
  const brand = inDock && client.id === 'codex' ? 'codex-mark' : client.brand;
  return client.id === 'mcp'
    ? <span className="om-avatar om-mcp-generic-icon" aria-hidden="true">
        {inDock
          ? <svg viewBox="0 0 24 24" width="16" height="16"><IconGlyph id="mcp-client-plug" /></svg>
          : <RemixIcon name="plug-line" size={24} />}
      </span>
    : <ProviderAvatar name={client.name} provider={{ id: brand, custom: false }} />;
}
