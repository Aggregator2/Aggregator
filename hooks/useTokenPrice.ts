import { useState, useEffect } from "react";

const ADDRESS_TO_COINGECKO_ID: Record<string, string> = {
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": "ethereum",
  "0x9d47894f8becb68b9cf3428d256311affe8b068b": "rope-token",
};

export function useTokenPrice(contractAddress: string | null) {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contractAddress) return;
    const coingeckoId = ADDRESS_TO_COINGECKO_ID[contractAddress.toLowerCase()];
    if (!coingeckoId) {
      setPrice(null);
      return;
    }
    const fetchPrice = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`
        );
        if (!res.ok) throw new Error("Failed to fetch price");
        const data = await res.json();
        setPrice(data[coingeckoId]?.usd ?? null);
      } catch (err) {
        setPrice(null);
      } finally {
        setLoading(false);
      }
    };
    fetchPrice();
  }, [contractAddress]);

  return { price, loading };
}