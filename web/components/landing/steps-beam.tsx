"use client";
import { TracingBeam } from "../ui/tracing-beam";
import { useMotionAllowed } from "../motion";

/** The registry tracing beam alongside the survival steps, only when motion is allowed. At rest the
 *  steps' own static rail shows the sequence. */
export function StepsBeam({ children }: { children: React.ReactNode }) {
  const allowed = useMotionAllowed();
  if (!allowed) return <>{children}</>;
  return <TracingBeam className="max-w-none">{children}</TracingBeam>;
}
