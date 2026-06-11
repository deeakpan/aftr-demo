import { redirect } from "next/navigation";

/** @deprecated Use /bounty-board */
export default function LeaderboardRedirectPage() {
  redirect("/bounty-board");
}
