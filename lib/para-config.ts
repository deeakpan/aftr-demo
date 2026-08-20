export type ParaEnvName = "BETA" | "PROD";

export function getParaEnvName(): ParaEnvName {
  const raw = (process.env.PARA_ENV ?? process.env.NEXT_PUBLIC_PARA_ENV ?? "BETA").trim().toUpperCase();
  return raw === "PROD" || raw === "PRODUCTION" ? "PROD" : "BETA";
}

/** Public modal key — safe in the browser. */
export function getParaApiKey(): string {
  return (
    process.env.NEXT_PUBLIC_PARA_API_KEY?.trim() ||
    process.env.PARA_API_KEY?.trim() ||
    ""
  );
}

export function isParaConfigured(): boolean {
  return getParaApiKey().length > 0;
}

export function getParaApiSecret(): string {
  return process.env.PARA_API_SECRET?.trim() || "";
}

export function getParaApiBase(): string {
  const override = process.env.PARA_API_BASE?.trim();
  if (override) return override.replace(/\/$/, "");
  return getParaEnvName() === "PROD" ? "https://api.getpara.com" : "https://api.beta.getpara.com";
}
