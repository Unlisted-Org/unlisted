"use client";
import { motion } from "motion/react";
import { useMotionAllowed } from "../motion";

// Transfer fee on the basket's PreStocks mints, as set on chain (docs/risks.md §1).
const STEPS = [
  { date: "before", bps: 0 },
  { date: "8 Sep", bps: 50 },
  { date: "19 Sep", bps: 100 },
  { date: "24 Sep", bps: 300 },
];

export function FeeSteps() {
  const allowed = useMotionAllowed();
  const W = 320, H = 170, L = 40, R = 28, T = 14, B = 26;
  const x = (i: number) => L + (i * (W - L - R)) / (STEPS.length - 1);
  const y = (bps: number) => T + (H - T - B) * (1 - bps / 300);
  let d = `M ${x(0)} ${y(0)}`;
  STEPS.forEach((s, i) => {
    if (i === 0) return;
    d += ` H ${x(i)} V ${y(s.bps)}`;
  });
  d += ` H ${W - R}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Transfer fee: 0, then 50 bps on 8 Sep, 100 bps on 19 Sep, 300 bps set on 24 Sep 2026">
      {[0, 100, 200, 300].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--ink-muted)" fontFamily="var(--font-mono)">{v}</text>
        </g>
      ))}
      {STEPS.map((s, i) => (
        <text key={s.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--ink-muted)" fontFamily="var(--font-mono)">{s.date}</text>
      ))}
      <text x={L} y={T - 4} fontSize="10" fill="var(--ink-muted)" fontFamily="var(--font-mono)">bps</text>
      <motion.path
        d={d}
        fill="none"
        stroke="var(--issuer)"
        strokeWidth="2.5"
        initial={false}
        whileInView={allowed ? { pathLength: [0, 1] } : undefined}
        viewport={{ once: true, amount: 0.8 }}
        transition={{ duration: 1.6, ease: "easeInOut" }}
      />
      {STEPS.slice(1).map((s, i) => (
        <circle key={s.date} cx={x(i + 1)} cy={y(s.bps)} r="3.5" fill="var(--issuer)" />
      ))}
    </svg>
  );
}
