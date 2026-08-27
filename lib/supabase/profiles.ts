import {
  clearCachedProfileName,
  getCachedProfileName,
  setCachedProfileName,
  useProfileName,
} from "@/lib/profile-name-store";

export type UserProfileInput = {
  address: string;
  name: string;
};

export type UserProfile = {
  address: string;
  name: string;
};

export {
  clearCachedProfileName,
  getCachedProfileName,
  setCachedProfileName,
  useProfileName,
};

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function getUserProfileByAddress(address: string): Promise<UserProfile | null> {
  const normalizedAddress = address.toLowerCase().trim();
  if (!normalizedAddress) {
    throw new Error("Address is required.");
  }

  const res = await fetch(`/api/profile?address=${encodeURIComponent(normalizedAddress)}`, {
    cache: "no-store",
  });
  const body = await readJson<{ profile?: UserProfile | null; error?: string }>(res);
  if (!res.ok) {
    throw new Error(body.error || "Profile lookup failed.");
  }
  const profile = body.profile ?? null;
  if (profile?.name) setCachedProfileName(normalizedAddress, profile.name);
  return profile;
}

export async function saveUserProfile({ address, name }: UserProfileInput): Promise<UserProfile> {
  const normalizedAddress = address.toLowerCase().trim();
  const trimmedName = name.trim();

  if (!normalizedAddress) {
    throw new Error("Address is required.");
  }
  if (!trimmedName) {
    throw new Error("Name is required.");
  }

  // Always cache locally first so UI doesn't reset if Supabase times out.
  setCachedProfileName(normalizedAddress, trimmedName);

  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: normalizedAddress, name: trimmedName }),
  });
  const body = await readJson<{ profile?: UserProfile; error?: string }>(res);
  if (!res.ok || !body.profile) {
    throw new Error(body.error || "Could not save profile.");
  }
  return body.profile;
}
