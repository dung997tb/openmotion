import type { DomEditPatchBatch } from "../../hooks/domEditCommitTypes";
import { readTagAttribute, readTagSnippetByTarget, type PatchTarget } from "../../utils/sourcePatcher";
import { readProjectFileContent } from "../../utils/studioFileHistory";
import { buildDomEditRichTextPatchOperation } from "./domEditingLayers";
import { isIsolatedSourceFile, isIsolatedSourceTarget, isolatedPatchTarget, type IsolatedSourceTarget } from "./isolatedSourceTarget";

interface VariableOwner extends IsolatedSourceTarget {
  key: string;
  attribute: "data-composition-variables" | "data-variable-values";
  htmlRoot?: boolean;
}

export interface InlineTextTarget extends IsolatedSourceTarget {
  binding?: VariableOwner;
}

export function isInlineTextTarget(value: InlineTextTarget | null): value is InlineTextTarget {
  if (!isIsolatedSourceTarget(value)) return false;
  const binding = value.binding;
  if (binding === undefined) return true;
  if (!binding || typeof binding.key !== "string" || !binding.key.trim()) return false;
  if (binding.attribute !== "data-composition-variables" && binding.attribute !== "data-variable-values") return false;
  return binding.htmlRoot === true
    ? binding.attribute === "data-composition-variables" && isIsolatedSourceFile(binding)
    : isIsolatedSourceTarget(binding);
}

function updatedBinding(raw: string | undefined, binding: VariableOwner, text: string): string {
  if (binding.attribute === "data-variable-values") {
    const values = raw === undefined ? {} : JSON.parse(raw);
    if (!values || Array.isArray(values) || typeof values !== "object" ||
        (Object.hasOwn(values, binding.key) && typeof values[binding.key] !== "string")) {
      throw new Error("The instance value is no longer a text variable.");
    }
    return JSON.stringify({ ...values, [binding.key]: text });
  }
  const entries: unknown = raw && JSON.parse(raw);
  if (!Array.isArray(entries)) throw new Error("The text declaration is no longer present.");
  const entry = entries.findLast(item => item?.id === binding.key && Object.hasOwn(item, "default"));
  if (entry?.type !== "string" || typeof entry.default !== "string") throw new Error("The text variable has changed.");
  entry.default = text;
  return JSON.stringify(entries);
}

/** Use the source versions picked together. The aggregate endpoint checks both before writing either file. */
export async function inlineTextBatches(
  projectId: string, target: InlineTextTarget, html: string, text: string | undefined,
  readFile = readProjectFileContent,
): Promise<DomEditPatchBatch[]> {
  const location = isolatedPatchTarget(target);
  const textBatch: DomEditPatchBatch = {
    sourceFile: location.sourceFile, ifMatch: location.ifMatch,
    patches: [{ target: location.target, operations: [buildDomEditRichTextPatchOperation(html)] }],
  };
  const binding = target.binding;
  if (!binding) return [textBatch];
  if (typeof text !== "string") throw new Error("Missing text for the bound variable.");
  const owner = isolatedPatchTarget(binding);
  const ownerTarget: PatchTarget = binding.htmlRoot ? { selector: "html" } : { hfId: binding.hfId, id: binding.elementId };
  const source = await readFile(projectId, owner.sourceFile);
  let raw: string | undefined;
  if (binding.htmlRoot) {
    raw = new DOMParser().parseFromString(source, "text/html").documentElement.getAttribute(binding.attribute) ?? undefined;
  } else {
    const tag = readTagSnippetByTarget(source, ownerTarget);
    if (!tag) throw new Error("The bound variable's owner was not found.");
    if (binding.attribute === "data-variable-values" && !readTagAttribute(tag, "data-composition-src") &&
        !readTagAttribute(tag, "data-composition-template")) throw new Error("The variable instance has changed.");
    raw = readTagAttribute(tag, binding.attribute);
  }
  const value = updatedBinding(raw, binding, text);
  const patch: DomEditPatchBatch["patches"][number] = {
    target: ownerTarget, operations: [{ type: "attribute", property: binding.attribute, value }],
  };
  if (owner.sourceFile !== textBatch.sourceFile) {
    return [textBatch, { sourceFile: owner.sourceFile, ifMatch: owner.ifMatch, patches: [patch] }];
  }
  if (owner.ifMatch !== textBatch.ifMatch) throw new Error("The variable and text source versions differ.");
  textBatch.patches.push(patch);
  return [textBatch];
}
