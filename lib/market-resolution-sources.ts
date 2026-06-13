export type ResolutionSource = {
  label: string;
  url: string;
};

export function isValidSourceUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeResolutionSources(raw: unknown): ResolutionSource[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item, i) => {
      if (typeof item === "string") {
        const url = item.trim();
        if (!isValidSourceUrl(url)) return null;
        return { label: `Source ${i + 1}`, url };
      }
      if (item && typeof item === "object" && "url" in item) {
        const url = String((item as { url: unknown }).url ?? "").trim();
        if (!isValidSourceUrl(url)) return null;
        const label =
          String((item as { label?: unknown }).label ?? "").trim() || `Source ${i + 1}`;
        return { label, url };
      }
      return null;
    })
    .filter(Boolean) as ResolutionSource[];
}

export function sanitizeResolutionSourcesForMetadata(
  rows: { label: string; url: string }[],
): ResolutionSource[] {
  return rows
    .map((row, i) => ({
      label: row.label.trim() || `Source ${i + 1}`,
      url: row.url.trim(),
    }))
    .filter((row) => isValidSourceUrl(row.url));
}
