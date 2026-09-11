function copyViaExecCommand(value: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.createElement("textarea");
  el.value = value;
  el.setAttribute("readonly", "");
  el.setAttribute("aria-hidden", "true");
  // Keep in-viewport and selectable — iOS rejects off-screen / opacity:0 nodes.
  el.style.cssText =
    "position:fixed;top:0;left:0;width:2em;height:2em;padding:0;margin:0;border:0;outline:none;box-shadow:none;background:transparent;color:transparent;font-size:16px;";
  document.body.appendChild(el);

  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  el.focus();
  el.setSelectionRange(0, value.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  selection?.removeAllRanges();
  document.body.removeChild(el);
  return ok;
}

/**
 * Copy text for mobile + desktop.
 * Tries synchronous execCommand first so iOS keeps the user-gesture,
 * then falls back to the async Clipboard API.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;

  // Sync path first — critical on iOS Safari (gesture dies after await).
  if (copyViaExecCommand(value)) return true;

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}
