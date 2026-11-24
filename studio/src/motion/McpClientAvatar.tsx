import { IconGlyph } from '../../../packages/design-system/react/IconGlyph';
import type { mcpClients } from './mcpClients';
import { ProviderAvatar } from './settingsPrimitives';

export function McpClientAvatar({ client, inDock = false }: { client: typeof mcpClients[number]; inDock?: boolean }) {
  const brand = inDock && client.id === 'codex' ? 'codex-mark' : client.brand;
  const plugSize = inDock ? 16 : 24;
  return client.id === 'mcp'
    ? <span className="om-avatar om-mcp-generic-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width={plugSize} height={plugSize}><IconGlyph id="mcp-client-plug" /></svg>
      </span>
    : <ProviderAvatar name={client.name} provider={{ id: brand, custom: false }} />;
}
