import type { Metadata } from "next";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./holder.css";
import { Frame } from "./frame";

export const metadata: Metadata = {
  title: { default: "Unlisted app (devnet)", template: "%s · Unlisted app (devnet)" },
  description: "Hold, buy into and redeem the Unlisted basket on Solana devnet. Paused companies become claims; nothing here is mainnet.",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Frame>{children}</Frame>;
}
