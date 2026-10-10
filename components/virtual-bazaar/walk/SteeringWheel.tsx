"use client";

import { useEffect, useRef, useState } from "react";

/**
 * THE STEERING WHEEL (founder, 2026-10-10: "make the wheel exactly be like
 * and behave like a steering wheel, a self drive should turn the wheel when
 * photographer has turned").
 *
 * - Grab the rim and turn it, like a car's: the further round, the faster
 *   the view turns (up to ±`LOCK_DEG`). Let go and it centres itself.
 * - Not held, it turns as the photographer turned at this moment of the walk
 *   (`follow`, radians per second, + right) — riding along, the wheel moves
 *   with the road.
 * - The cap in the middle is the pedals: hold ▲ to walk on, ▼ to walk back.
 *
 * Everything that moves is drawn straight to the SVG each frame, not through
 * React state: the wheel turns at the screen's rate without re-rendering.
 */

/** How far the wheel turns either way (degrees). */
const LOCK_DEG = 120;
/** The photographer's turn (rad/s) that shows as full lock. */
const FULL_TURN = 0.7;
/** How quickly the wheel settles where it is going (s). */
const SETTLE_S = 0.18;

export default function SteeringWheel({ onMove, follow, className = "" }: {
  /** x: steering, −1 (full left) … 1 (full right); y: −1 walk on, 1 walk back, 0 stand. */
  onMove: (x: number, y: number) => void;
  /** The photographer's turn now, in radians per second (+ right). */
  follow?: () => number;
  className?: string;
}) {
  const wheel = useRef<SVGGElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [pedal, setPedal] = useState(0);
  const st = useRef({
    shown: 0, // degrees, as drawn
    steer: null as null | { id: number; last: number; turned: number },
    pedals: new Map<number, number>(),
    x: 0,
    y: 0,
  });
  const followRef = useRef(follow);
  followRef.current = follow;
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  useEffect(() => {
    let raf = 0;
    let at = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - at) / 1000);
      at = now;
      const s = st.current;
      const road = Math.max(-1, Math.min(1, (followRef.current?.() ?? 0) / FULL_TURN)) * LOCK_DEG;
      // Held: where the hands put it (on top of the road's turn); let go: back to the road.
      const want = s.steer ? Math.max(-LOCK_DEG, Math.min(LOCK_DEG, road + s.steer.turned)) : road;
      s.shown += (want - s.shown) * (1 - Math.exp(-dt / (s.steer ? 0.03 : SETTLE_S)));
      wheel.current?.setAttribute("transform", `rotate(${s.shown.toFixed(2)})`);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const send = () => {
    const s = st.current;
    const x = s.steer ? Math.max(-1, Math.min(1, s.steer.turned / LOCK_DEG)) : 0;
    let y = 0;
    for (const v of s.pedals.values()) y = v;
    if (x !== s.x || y !== s.y) {
      s.x = x;
      s.y = y;
      moveRef.current(x, y);
    }
    setPedal(y);
  };

  /** Where a pointer is on the wheel: its angle from 12 o'clock (degrees, clockwise) and how far out (0 centre, 1 rim). */
  const where = (e: React.PointerEvent) => {
    const r = root.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return { deg: (Math.atan2(dx, -dy) * 180) / Math.PI, out: Math.hypot(dx, dy) / (r.width / 2), up: dy < 0 };
  };

  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = where(e);
    const s = st.current;
    if (p.out < 0.36) s.pedals.set(e.pointerId, p.up ? -1 : 1);
    else if (!s.steer) s.steer = { id: e.pointerId, last: p.deg, turned: 0 };
    send();
  };
  const move = (e: React.PointerEvent) => {
    const s = st.current;
    if (s.steer?.id !== e.pointerId) return;
    const p = where(e);
    let d = p.deg - s.steer.last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    s.steer.last = p.deg;
    s.steer.turned = Math.max(-LOCK_DEG * 1.5, Math.min(LOCK_DEG * 1.5, s.steer.turned + d));
    send();
  };
  const up = (e: React.PointerEvent) => {
    const s = st.current;
    if (s.steer?.id === e.pointerId) s.steer = null;
    s.pedals.delete(e.pointerId);
    send();
  };

  return (
    <div
      ref={root}
      role="group"
      aria-label="Steering wheel: turn the rim to steer; hold the middle — top to walk on, bottom to walk back"
      className={`absolute h-40 w-40 touch-none select-none ${className}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <svg viewBox="-100 -100 200 200" className="h-full w-full drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">
        <g ref={wheel}>
          {/* Spokes: 9, 3 and 6 o'clock, as on a car. */}
          <path d="M -30 -4 L -84 -10 L -84 14 L -30 12 Z" fill="rgba(30,30,32,0.92)" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
          <path d="M 30 -4 L 84 -10 L 84 14 L 30 12 Z" fill="rgba(30,30,32,0.92)" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
          <path d="M -12 30 L -16 84 L 16 84 L 12 30 Z" fill="rgba(30,30,32,0.92)" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
          {/* The rim, with grips and the centre mark at 12 o'clock. */}
          <circle r="84" fill="none" stroke="rgba(18,18,20,0.9)" strokeWidth="18" />
          <circle r="93" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
          <circle r="75" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
          <path d="M -60 -59 A 84 84 0 0 0 -84 0" fill="none" stroke="rgba(60,60,64,0.95)" strokeWidth="18" strokeLinecap="round" />
          <path d="M 60 -59 A 84 84 0 0 1 84 0" fill="none" stroke="rgba(60,60,64,0.95)" strokeWidth="18" strokeLinecap="round" />
          <rect x="-5" y="-93" width="10" height="18" rx="2" fill="rgba(252,211,77,0.95)" />
        </g>
        {/* The cap stays upright: the pedals. */}
        <circle r="34" fill="rgba(25,25,28,0.95)" stroke="rgba(252,211,77,0.7)" strokeWidth="2" />
        <path d="M -34 0 A 34 34 0 0 1 34 0 Z" fill={pedal < 0 ? "rgba(252,211,77,0.55)" : "transparent"} />
        <path d="M -34 0 A 34 34 0 0 0 34 0 Z" fill={pedal > 0 ? "rgba(252,211,77,0.55)" : "transparent"} />
        <line x1="-30" y1="0" x2="30" y2="0" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
        <text y="-9" textAnchor="middle" fontSize="20" fill="rgba(255,255,255,0.85)">▲</text>
        <text y="25" textAnchor="middle" fontSize="20" fill="rgba(255,255,255,0.85)">▼</text>
      </svg>
    </div>
  );
}
