import { checkSubCompositionUsability, parseHTMLContent } from '@hyperframes/core/compiler';
import type { RegistryItem } from '@hyperframes/core/registry';

export function primaryFile(item: RegistryItem) {
  return item.files.find(file => file.type === 'hyperframes:snippet')
    ?? item.files.find(file => file.type === 'hyperframes:composition') ?? item.files[0];
}

// Upstream supplies both ready-made compositions and bare HTML snippets. The
// preview compiler mounts compositions through their root, including its children.
export function mountableSnippet(name: string, bytes: Buffer): Buffer {
  const html = bytes.toString('utf8');
  const result = checkSubCompositionUsability(html, parseHTMLContent);
  if (result.ok || result.reason !== 'no-composition-root') return bytes;
  return Buffer.from(`<div data-composition-id="${name}" data-width="1920" data-height="1080">\n${html}\n</div>`);
}
