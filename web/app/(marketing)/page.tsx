import { Hero } from "@/components/landing/hero";
import { Incidents } from "@/components/landing/incidents";
import { Versus } from "@/components/landing/versus";
import { Survive } from "@/components/landing/survive";
import { Cost } from "@/components/landing/cost";
import { Disclosures } from "@/components/landing/disclosures";
import { Close } from "@/components/landing/close";

// Five sections: what it is; the problem; why everything else breaks; how this one survives; what it
// costs and what we don't claim. The full evidence (every signature, slot and table) is at /evidence.
export default function Home() {
  return (
    <main>
      <Hero />
      <Incidents />
      <Versus />
      <Survive />
      <Cost />
      <Disclosures />
      <Close />
    </main>
  );
}
