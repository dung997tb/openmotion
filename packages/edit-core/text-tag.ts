export function isTextBearingTag(tagName: string): boolean {
  return ["div", "span", "p", "strong", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName);
}

/** Root text without an authored window is visible for the whole composition. */
export function isUntimedRootText(el: Element, root: Element | null): boolean {
  if (!root || el.hasAttribute("data-start") || el.closest("[data-composition-id]") !== root) return false;
  const timedParent = el.parentElement?.closest("[data-start]");
  return (!timedParent || timedParent === root)
    && isTextBearingTag(el.localName)
    && !!el.textContent?.trim()
    && Array.from(el.children).every(child => child.localName === "br");
}
