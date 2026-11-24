import { openComposition } from '@hyperframes/sdk';

/** Read the same authored IDs used by edit commands, without starting a preview. */
export async function inspectComposition(source: string, sourceFile: string, offset = 0, limit = 50) {
  const session = await openComposition(source, { history: false });
  try {
    const elements = session.getElements();
    const page = elements.slice(offset, offset + limit);
    return {
      sourceFile, total: elements.length, nextOffset: offset + page.length < elements.length ? offset + page.length : null,
      elements: page.map(element => ({
        sourceFile, hfId: element.id, tag: element.tag,
        ...(element.scopedId !== element.id && { scopedId: element.scopedId }),
        ...(element.attributes.id && { id: element.attributes.id }),
        ...(element.text && { text: element.text.slice(0, 160) }),
        ...(element.start !== null && { start: element.start }),
        ...(element.duration !== null && { duration: element.duration }),
        ...(element.trackIndex !== null && { track: element.trackIndex }),
        ...(element.attributes['data-composition-src'] && { compositionSrc: element.attributes['data-composition-src'] }),
        ...(element.animationIds.length && { animationIds: element.animationIds }),
      })),
    };
  } finally {
    session.dispose();
  }
}
