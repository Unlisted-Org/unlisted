import type { Metadata } from "next";
import { SellView } from "../views";

export const metadata: Metadata = { title: "Sell" };

export default function SellPage() {
  return <SellView />;
}
