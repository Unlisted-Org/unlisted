import type { Metadata } from "next";
import "./holder.css";

export const metadata: Metadata = {
  title: "Unlisted app (devnet)",
  description: "Hold, deposit into and redeem the Unlisted basket on Solana devnet. Paused legs become claims; nothing here is mainnet.",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
