import { RUNTIME_BOOTSTRAP_ATTR } from '@hyperframes/core/compiler';

// Only certify static markup whose HTML inputs the compiler can enumerate. Runtime scripts,
// embedded documents, external styles and unrecognized markup retain whole-preview refresh.
const passiveTags = new Set(('html head title meta style body main section div article aside nav header footer ' +
  'span p h1 h2 h3 h4 h5 h6 b i em strong small br ol ul li figure figcaption ' +
  'img picture audio video source track template').split(' '));
const plainMedia = /^[\w./-]+\.(?:png|jpe?g|gif|webp|avif|svg|mp[34]|mov|webm|wav|ogg|m4[av]|vtt)$/i;

function hasUnknownInputs(root: Document | DocumentFragment, runtime?: Element | null): boolean {
  return Array.from(root.querySelectorAll('*')).some(el => {
    if (el === runtime) return false;
    if (!passiveTags.has(el.localName) || el.hasAttribute('http-equiv') || el.hasAttribute('srcset')) return true;
    if (el.localName === 'template' && hasUnknownInputs((el as HTMLTemplateElement).content)) return true;
    // CSS can load more resources through @import, url(), image-set() or escaped identifiers.
    const css = el.localName === 'style' ? el.textContent : el.getAttribute('style');
    if (css && /[(@\\]/.test(css)) return true;
    return el.getAttributeNames().some(name => /^on/i.test(name) ||
      (['src', 'poster', 'href'].includes(name) && !plainMedia.test(el.getAttribute(name) ?? '')));
  });
}

export function staticPreviewHtmlSources(entry: string, doc: Document, runtimeUrl: string) {
  const scripts = doc.querySelectorAll('script');
  const runtime = scripts.length === 1 && scripts[0]?.hasAttribute(RUNTIME_BOOTSTRAP_ATTR) &&
    scripts[0].getAttribute('src') === runtimeUrl && !scripts[0].textContent?.trim() ? scripts[0] : null;
  let known = !hasUnknownInputs(doc, runtime);
  const sources = new Set([entry]);
  return {
    add(path: string) { if (known) sources.add(path); },
    inspect(child: Document) { if (known && hasUnknownInputs(child)) known = false; },
    markUnknown() { known = false; },
    paths() { return known ? [...sources] : undefined; },
  };
}
