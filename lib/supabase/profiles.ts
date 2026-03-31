import { getSupabaseClient } from "./client";

export type UserProfileInput = {
  address: string;
  name: string;
};

export async function saveUserProfile({ address, name }: UserProfileInput) {
  const supabase = getSupabaseClient();
  const normalizedAddress = address.toLowerCase().trim();
  const trimmedName = name.trim();

  if (!normalizedAddress) {
    throw new Error("Address is required.");
  }

  if (!trimmedName) {
    throw new Error("Name is required.");
  }

  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        address: normalizedAddress,
        name: trimmedName,
      },
      { onConflict: "address" },
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getUserProfileByAddress(address: string) {
  const supabase = getSupabaseClient();
  const normalizedAddress = address.toLowerCase().trim();

  if (!normalizedAddress) {
    throw new Error("Address is required.");
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("address,name")
    .eq("address", normalizedAddress)
    .maybeSingle();

  if (error) throw error;
  return data;
}
