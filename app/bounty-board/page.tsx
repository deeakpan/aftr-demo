import { redirect } from "next/navigation";

/** @deprecated Use /leaderboard */
export default function BountyBoardRedirectPage() {
  redirect("/leaderboard");
}
