import dns from "node:dns";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch {
    /* Node < 17 */
  }
}
