"use client";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

/**
 * True only on the client, after mount, when the viewer has not asked for reduced motion.
 * Server render and first paint are always the finished, static state, so every section is
 * complete at rest and animation is an enhancement layered on top.
 */
export function useMotionAllowed() {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && reduce === false;
}
