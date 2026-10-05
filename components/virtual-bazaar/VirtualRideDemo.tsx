"use client";

import { useState } from "react";
import VirtualRide from "./VirtualRide";
import { districtById, type RideDistrict } from "@/lib/virtualRide/districts";

/**
 * The first milestone of the Virtual Ride, end to end: a stand-in for
 * district A with «Take Virtual Ride», the Google 3D flight, then district B.
 * The two district panels stand in for our real scenes (bazaar, splat tour,
 * 360° walk), which a later step mounts in their place.
 */
export default function VirtualRideDemo({ fromId, toId }: { fromId: string; toId: string }) {
  const from = districtById(fromId)!;
  const to = districtById(toId)!;
  const [stage, setStage] = useState<"origin" | "riding" | "arrived">("origin");

  if (stage === "riding") {
    return <VirtualRide from={from} to={to} onArrival={() => setStage("arrived")} />;
  }
  if (stage === "arrived") return <DistrictPanel district={to} arrived onBack={() => setStage("origin")} />;
  return <DistrictPanel district={from} onRide={() => setStage("riding")} rideTo={to} />;
}

function DistrictPanel({
  district,
  arrived,
  rideTo,
  onRide,
  onBack,
}: {
  district: RideDistrict;
  arrived?: boolean;
  rideTo?: RideDistrict;
  onRide?: () => void;
  onBack?: () => void;
}) {
  return (
    <main
      className="min-h-screen grid place-items-center p-4 bg-neutral-950 text-white"
      style={arrived ? { animation: "sk-ride-in 900ms ease-out" } : undefined}
    >
      <style>{`@keyframes sk-ride-in { from { opacity: 0 } to { opacity: 1 } }`}</style>
      <div className="w-full max-w-md text-center space-y-4">
        <p className="text-sm text-neutral-400">{arrived ? "You have arrived at" : "You are in"}</p>
        <h1 className="text-3xl font-bold">{district.name.en}</h1>
        <p className="text-xl text-neutral-300" dir="rtl">{district.name.fa}</p>

        {district.entryScene ? (
          <a href={district.entryScene} className="inline-block underline text-neutral-300">
            Enter the district&apos;s scene
          </a>
        ) : (
          <p className="text-sm text-neutral-500">This district has no virtual scene yet.</p>
        )}

        {rideTo && onRide && (
          <div className="pt-4">
            <button
              type="button"
              onClick={onRide}
              className="px-6 py-3 rounded-full bg-white text-black font-semibold"
            >
              Take Virtual Ride → {rideTo.name.en}
            </button>
          </div>
        )}
        {arrived && onBack && (
          <button type="button" onClick={onBack} className="text-sm text-neutral-400 underline">
            Back to the start
          </button>
        )}
      </div>
    </main>
  );
}
