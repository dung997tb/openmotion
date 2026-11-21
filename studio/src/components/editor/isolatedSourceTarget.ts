/** The editable location reported by the preview document the user is looking at. */
export interface IsolatedSourceTarget {
  sourceFile: string;
  sha256: string;
  elementId?: string;
  hfId?: string;
}

export function isIsolatedSourceFile(target: IsolatedSourceTarget | null): target is IsolatedSourceTarget {
  if (!target || typeof target.sourceFile !== "string" || !/\.html?$/i.test(target.sourceFile)) return false;
  const safePath = target.sourceFile.split("/").every(part => part && part !== "." && part !== "..");
  return safePath && !/[\\:%?#\u0000-\u001f]/.test(target.sourceFile)
    && typeof target.sha256 === "string" && /^[0-9a-f]{64}$/.test(target.sha256);
}

export function isIsolatedSourceTarget(target: IsolatedSourceTarget | null): target is IsolatedSourceTarget {
  return isIsolatedSourceFile(target) && [target.hfId, target.elementId].some(id => typeof id === "string" && id.length > 0);
}

export function isolatedPatchTarget({ sourceFile, sha256, elementId, hfId }: IsolatedSourceTarget) {
  const target = typeof hfId === "string" && hfId ? { hfId } : { id: elementId };
  return { sourceFile, ifMatch: '"sha256:' + sha256 + '"', target };
}
