/** /operator/agents — what every agent is doing, on one screen (operator only). `components/operator/AgentsBoard.tsx`. */
import type { Metadata } from "next";
import OperatorGate from "@/components/operator/OperatorGate";
import AgentsBoard from "@/components/operator/AgentsBoard";

export const metadata: Metadata = { title: "Agents — Virtual Bazaar", robots: { index: false, follow: false } };

export default function AgentsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-6 sm:px-6">
      <OperatorGate><AgentsBoard /></OperatorGate>
    </main>
  );
}
