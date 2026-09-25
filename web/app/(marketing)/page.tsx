import { Hero } from "@/components/landing/hero";
import { Incidents } from "@/components/landing/incidents";
import { Versus } from "@/components/landing/versus";
import { Survive } from "@/components/landing/survive";
import { Proof } from "@/components/landing/proof";
import { Cost } from "@/components/landing/cost";
import { Disclosures } from "@/components/landing/disclosures";
import { Close } from "@/components/landing/close";

export default function Home() {
  return (
    <main>
      <Hero />
      <Incidents />
      <Versus />
      <Survive />
      <Proof />
      <Cost />
      <Disclosures />
      <Close />
    </main>
  );
}
