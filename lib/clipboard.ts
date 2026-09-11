/** iOS-safe legacy copy (github/gh-aw pattern). */
function copyViaExecCommand(value: string): boolean {
  if (typeof document === "undefined") return false;

  const el = document.createElement("textarea");
  el.value = value;
  el.setAttribute("readonly", "");
  el.setAttribute("aria-hidden", "true");
  el.tabIndex = -1;
  // absolute + scrollTop keeps the node in the visual viewport on iOS.
  const top = window.pageYOffset || document.documentElement.scrollTop || 0;
  el.style.cssText = [
    "position:absolute",
    "left:-9999px",
    `top:${top}px`,
    "width:1px",
    "height:1px",
    "padding:0",
    "margin:0",
    "border:0",
    "outline:none",
    "box-shadow:none",
    "background:transparent",
    "font-size:12pt", // prevents iOS zoom-on-focus
  ].join(";");

  document.body.appendChild(el);
  el.focus({ preventScroll: true });
  el.setSelectionRange(0, value.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  document.body.removeChild(el);
  return ok;
}

/** Copy from an already-mounted input/textarea (best path on iOS). */
export function copyFromTextField(field: HTMLInputElement | HTMLTextAreaElement): boolean {
  try {
    const len = field.value.length;
    field.focus({ preventScroll: true });
    field.setSelectionRange(0, len);
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

/**
 * Copy text for mobile + desktop.
 * Starts Clipboard API in the same tick as the click (Safari gesture),
 * then falls back to iOS-tuned execCommand.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;

  // Kick Clipboard API immediately — do not await anything before this call.
  let clipboardPromise: Promise<void> | null = null;
  if (typeof navigator !== "undefined" && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      clipboardPromise = navigator.clipboard.writeText(value);
    } catch {
      clipboardPromise = null;
    }
  }

  if (copyViaExecCommand(value)) {
    // Still let the modern write finish if it was started.
    if (clipboardPromise) void clipboardPromise.catch(() => undefined);
    return true;
  }

  if (clipboardPromise) {
    try {
      await clipboardPromise;
      return true;
    } catch {
      // fall through
    }
  }

  return false;
}

/** Prefer native share sheet on mobile (includes Copy on iOS). */
export async function shareText(text: string, title = "Wallet address"): Promise<boolean> {
  const value = text.trim();
  if (!value || typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return false;
  }
  try {
    await navigator.share({ title, text: value });
    return true;
  } catch {
    // user cancelled or share unavailable
    return false;
  }
}
