import type { Metadata } from "next";
import { ClaimsView } from "../views";

export const metadata: Metadata = { title: "Claims" };

export default function ClaimsPage() {
  return <ClaimsView />;
}
