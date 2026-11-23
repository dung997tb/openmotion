import { RemixIcon } from '../icons/RemixIcons';
import type { mcpClients } from './mcpClients';
import { ProviderAvatar } from './settingsPrimitives';

export function McpClientAvatar({ client, inDock = false }: { client: typeof mcpClients[number]; inDock?: boolean }) {
  const brand = inDock && client.id === 'codex' ? 'codex-mark' : client.brand;
  return client.id === 'mcp'
    ? <span className="om-avatar om-mcp-generic-icon" aria-hidden="true"><RemixIcon name="plug-line" size={24} /></span>
    : <ProviderAvatar name={client.name} provider={{ id: brand, custom: false }} />;
}
