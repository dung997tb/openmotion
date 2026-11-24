import postcss from 'postcss';
import { decodeAuthoredAttribute, scanHtmlOpeningTags } from '@hyperframes/parsers/html-attribute-spans';

type Variable = { id: string; type: string; default: unknown; options?: { value: string }[] };
const attributeName = 'data-composition-variables';

/** A block's runtime consumes the declarations on its composition root. */
function readDeclarations(html: string) {
  if (!html.includes(attributeName)) return null;
  const root = scanHtmlOpeningTags(html).find(tag => tag.attributes.some(attr => attr.name === 'data-composition-id'));
  const attr = root?.attributes.find(attr => attr.name === attributeName);
  if (attr?.kind !== 'value') return null;
  const declarations: unknown = JSON.parse(decodeAuthoredAttribute(attr.value));
  if (!Array.isArray(declarations)) throw new Error('Invalid composition variable declarations.');
  return { attr, variables: declarations as Variable[] };
}

export function compositionVariableValues(html: string): Map<string, string> | null {
  const declarations = readDeclarations(html);
  return declarations && new Map(declarations.variables.map(variable => [variable.id, String(variable.default ?? '')]));
}

/** Registry cards may spell a declared ID such as cellSize as the CSS key --cellsize. */
export function declaredParameterId(ids: Iterable<string>, key: string): string | undefined {
  const list = [...ids];
  if (list.includes(key)) return key;
  if (!key.startsWith('--')) return;
  const matches = list.filter(id => id.toLowerCase() === key.slice(2).toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}

function scalarValue(variable: Variable, value: string) {
  switch (variable.type) {
    case 'boolean':
      if (value === 'true' || value === 'false') return value === 'true';
      break;
    case 'number':
      if (value.trim() && Number.isFinite(Number(value))) return Number(value);
      break;
    case 'enum':
      if (variable.options?.some(option => option.value === value)) return value;
      break;
    case 'string':
    case 'text':
    case 'color':
      return value;
  }
  throw new Error('Invalid value for composition variable ' + variable.id + '.');
}

/** Changes only the declaration attribute. Scripts, CSS and other identical values stay intact. */
function updateDeclaredVariable(source: string, key: string, value: string): string | null {
  const block = readDeclarations(source);
  if (!block) return null;
  const id = declaredParameterId(block.variables.map(variable => variable.id), key);
  const matches = block.variables.filter(variable => variable.id === id);
  if (!id || matches.length !== 1) throw new Error('Missing or ambiguous composition variable: ' + key);
  const variable = matches[0]!;
  const next = scalarValue(variable, value);
  if (Object.is(variable.default, next)) return source;
  variable.default = next;
  const { attr } = block;
  const json = JSON.stringify(block.variables).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const quote = attr.quote || '"';
  const encoded = quote === "'" ? json.replace(/'/g, '&#39;') : json.replace(/"/g, '&quot;');
  return source.slice(0, attr.valueStart) + (attr.quote ? encoded : quote + encoded + quote) + source.slice(attr.valueEnd);
}


/** Older blocks may declare a real CSS custom property in a style element. */
function updateCssParameter(source: string, key: string, value: string) {
  if (!key.startsWith('--') || !source.includes(key)) return null;
  let result: string | null = null;
  for (const tag of scanHtmlOpeningTags(source)) {
    if (tag.name !== 'style' || tag.rawTextEnd === null) continue;
    const sheet = postcss.parse(source.slice(tag.end, tag.rawTextEnd));
    sheet.walkDecls(key, declaration => {
      if (result !== null) throw new Error('Ambiguous CSS parameter: ' + key);
      declaration.value = value;
      result = source.slice(0, tag.end) + sheet.toString() + source.slice(tag.rawTextEnd!);
    });
  }
  return result;
}

export function setBlockParameter(source: string, key: string, value: string, path: string, previous?: string): string {
  const declared = updateDeclaredVariable(source, key, value) ?? updateCssParameter(source, key, value);
  if (declared !== null) return declared;
  if (previous === undefined) throw new Error('This legacy parameter needs its previous value: ' + key);
  return replaceLegacyLiteral(source, previous, value, path);
}

/** Old registry blocks without declarations can only bind an unambiguous literal. */
function replaceLegacyLiteral(content: string, previous: string, nextValue: string, path: string): string {
  if (previous === nextValue || !previous || !nextValue.trim()) return content;
  const matcher = new RegExp(`(?<![-\\w#])${previous.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![-\\w])`, "g");
  const matches = content.match(matcher)?.length ?? 0;
  if (!matches) throw new Error(`Couldn't find the current value in ${path}. It may have been edited by hand.`);
  if (matches > 1) throw new Error(`"${previous}" appears ${matches}× in ${path}. The panel can't tell which one belongs to this parameter, so it won't risk changing unrelated content. Edit the file directly to disambiguate.`);
  return content.replace(matcher, () => nextValue);
}
