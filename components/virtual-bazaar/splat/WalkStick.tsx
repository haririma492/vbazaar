"use client";

import { useRef, useState } from "react";

/**
 * THE STICK — pedal and steering wheel in one. Up walks forward, down steps
 * back, left and right turn; let go and you glide to a stop. A phone has no
 * keyboard, and someone who never played a game knows how to drive.
 */
export default function WalkStick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const R = 56; // how far the knob travels from the centre, in px
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const move = (e: React.PointerEvent) => {
    const o = origin.current;
    if (!o || e.pointerId !== o.id) return;
    let x = e.clientX - o.x;
    let y = e.clientY - o.y;
    const d = Math.hypot(x, y);
    if (d > R) {
      x = (x / d) * R;
      y = (y / d) * R;
    }
    setKnob({ x, y });
    onMove(x / R, y / R);
  };
  const end = (e: React.PointerEvent) => {
    if (origin.current?.id !== e.pointerId) return;
    origin.current = null;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };
  return (
    <div
      role="slider"
      aria-label="Drive: up forward, down back, left and right to turn"
      aria-valuenow={0}
      className="absolute bottom-20 right-5 h-40 w-40 touch-none select-none rounded-full border border-white/25 bg-black/40"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId };
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 rounded-full border border-amber-300/70 bg-amber-300/30"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
      <span className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 text-[11px] text-white/50">▲</span>
      <span className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] text-white/50">▼</span>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[13px] text-white/50">↺</span>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[13px] text-white/50">↻</span>
    </div>
  );
}
