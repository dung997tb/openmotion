/** The editable location reported by the preview document the user is looking at. */
export interface IsolatedSourceTarget {
  sourceFile: string;
  sha256?: string;
  fileVersion?: string;
  elementId?: string;
  hfId?: string;
}

export function isolatedSourceVersion(target: IsolatedSourceTarget): string {
  return target.fileVersion ?? '"sha256:' + target.sha256 + '"';
}

export function isIsolatedSourceFile(target: IsolatedSourceTarget | null): target is IsolatedSourceTarget {
  if (!target || typeof target.sourceFile !== "string" || !/\.html?$/i.test(target.sourceFile)) return false;
  const safePath = target.sourceFile.split("/").every(part => part && part !== "." && part !== "..");
  return safePath && !/[\\:%?#\u0000-\u001f]/.test(target.sourceFile)
    && /^"(?:sha256|patch):[0-9a-f]{64}"$/.test(isolatedSourceVersion(target));
}

export function isIsolatedSourceTarget(target: IsolatedSourceTarget | null): target is IsolatedSourceTarget {
  return isIsolatedSourceFile(target) && [target.hfId, target.elementId].some(id => typeof id === "string" && id.length > 0);
}

export function isolatedPatchTarget(location: IsolatedSourceTarget) {
  const { sourceFile, elementId, hfId } = location;
  const target = { ...(hfId && { hfId }), ...(elementId && { id: elementId }) };
  return { sourceFile, ifMatch: isolatedSourceVersion(location), target };
}
