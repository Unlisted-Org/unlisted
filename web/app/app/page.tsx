"use client";
import dynamic from "next/dynamic";
import { AppShell } from "./shell";

const Holder = dynamic(() => import("./_holder/Root"), {
  ssr: false,
  loading: () => <p className="muted" data-testid="app-loading">Loading the basket…</p>,
});

export default function AppPage() {
  return (
    <AppShell>
      <Holder />
    </AppShell>
  );
}
