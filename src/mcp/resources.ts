import { readFile } from 'node:fs/promises';
import { inlineVideoUri, legacyInlineVideoUri } from '../../shared/inline-video.ts';
import { readWorkflowResource, workflowResources } from '../../shared/workflow.ts';
import { CloudError } from '../contracts/errors.ts';

export const TEMPLATE_PRESENTATION_TOOL_NAME = 'openmotion_show_template_recommendations';

export interface McpTemplatePresentation {
  readonly uri: string;
  readonly resourceVersion: string;
  readonly tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: { readOnlyHint: boolean; openWorldHint: boolean };
    _meta: Record<string, unknown>;
  };
  readonly descriptor: { uri: string; name: string; mimeType: string };
  readonly content: {
    uri: string;
    mimeType: string;
    text: string;
    _meta: Record<string, unknown>;
  };
}

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  title?: string;
  mimeType: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType: string;
  text: string;
  _meta?: Record<string, unknown>;
}

export function listCloudMcpResources(options: {
  templatePresentation?: McpTemplatePresentation | null;
} = {}): McpResourceDescriptor[] {
  const base: McpResourceDescriptor[] = [
    ...workflowResources(),
    {
      uri: inlineVideoUri,
      name: 'Final video playback',
      mimeType: 'text/html;profile=mcp-app',
    },
  ];
  if (options.templatePresentation) {
    base.push(options.templatePresentation.descriptor);
  }
  return base;
}

export async function readCloudMcpResource(
  uri: string,
  options: {
    templatePresentation?: McpTemplatePresentation | null;
    publicOrigin?: string;
  } = {},
): Promise<McpResourceContent> {
  if (typeof uri !== 'string' || !uri.trim()) {
    throw new CloudError('INVALID_ARGUMENT', 'INVALID_RESOURCE_URI', { status: 400 });
  }

  if (uri === inlineVideoUri || uri === legacyInlineVideoUri) {
    try {
      const html = await readFile(new URL('../../web/inline-video.html', import.meta.url), 'utf8');
      const resourceDomains = ['data:', 'blob:'];
      if (options.publicOrigin) {
        try {
          resourceDomains.push(new URL(options.publicOrigin).origin);
        } catch {
          // Ignore invalid origin hint.
        }
      }
      return {
        uri,
        mimeType: 'text/html;profile=mcp-app',
        text: html,
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { connectDomains: [], resourceDomains },
          },
          'openai/ui': {
            availableDisplayModes: ['inline'],
            preferredDisplayMode: 'inline',
          },
        },
      };
    } catch {
      throw new CloudError(
        'SERVICE_UNAVAILABLE',
        'INLINE_UI_NOT_BUILT: run npm run build:inline',
        { status: 503 },
      );
    }
  }

  if (uri.startsWith('ui://openmotion/template-recommendations/')) {
    if (!options.templatePresentation || uri !== options.templatePresentation.uri) {
      throw new CloudError('NOT_FOUND', 'Unknown or unnegotiated UI resource', { status: 404 });
    }
    return options.templatePresentation.content;
  }

  try {
    return await readWorkflowResource(uri, '');
  } catch (error) {
    throw new CloudError(
      'INVALID_ARGUMENT',
      error instanceof Error ? error.message : 'INVALID_RESOURCE_URI',
      { status: 400 },
    );
  }
}
