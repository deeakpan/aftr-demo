import { MarketDetailClient } from "@/app/market/[address]/market-detail-client";

type Props = { params: Promise<{ address: string }> };

export default async function MarketAddressPage({ params }: Props) {
  const { address } = await params;
  return <MarketDetailClient address={address} />;
}
