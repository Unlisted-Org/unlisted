import type { Metadata } from "next";
import { BuyView } from "../views";

export const metadata: Metadata = { title: "Buy" };

export default function BuyPage() {
  return <BuyView />;
}
