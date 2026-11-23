import { parseHTMLContent } from '@hyperframes/core/compiler/html-document';
import { findTimelineScript } from '@hyperframes/parsers/gsap-parser-acorn';
import { clipQueryRoot } from '@hyperframes/parsers/gsap-writer-acorn';

export interface ExtractedGsapBlock {
  scriptText: string;
  document: Document;
  root: ParentNode;
  replaceScript(newText: string): string;
}

export function extractGsapScriptBlock(html: string): ExtractedGsapBlock | null {
  const document = parseHTMLContent(html);
  // linkedom serializes the template's child nodes, not its detached content fragment.
  const scripts = [
    ...Array.from(document.querySelectorAll('script:not([src])')),
    ...Array.from(document.querySelectorAll('template')).flatMap((tmpl) =>
      Array.from(tmpl.querySelectorAll('script:not([src])')),
    ),
  ];
  const script = findTimelineScript(scripts);
  if (!script) return null;
  return {
    scriptText: script.textContent || '',
    document,
    root: clipQueryRoot(script),
    replaceScript(newText: string): string {
      script.textContent = newText;
      return document.toString();
    },
  };
}
