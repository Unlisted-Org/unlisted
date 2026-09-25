"use client";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { useMotionAllowed } from "../motion";

/**
 * The template's perspective panel. At rest (and always under reduced motion) the panel sits at a
 * fixed tilt; with motion allowed the tilt eases flatter as it scrolls through the viewport.
 */
export function TiltOnScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const allowed = useMotionAllowed();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const rotateX = useTransform(scrollYProgress, [0, 0.5, 1], [14, 6, 0]);
  const rotateY = useTransform(scrollYProgress, [0, 0.5, 1], [-12, -5, 0]);
  const REST = { rotateX: 10, rotateY: -8 };
  return (
    <div ref={ref} className="[perspective:1600px]" data-motion={allowed ? "on" : "off"}>
      <motion.div style={allowed ? { rotateX, rotateY } : REST} className="origin-center will-change-transform">
        {children}
      </motion.div>
    </div>
  );
}
