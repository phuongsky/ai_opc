"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AgentDetailClient from "@/components/AgentDetailClient";
import AgentDirectoryClient from "@/components/AgentDirectoryClient";

function AgentPageContent() {
  const searchParams = useSearchParams();
  const agentId = searchParams.get("id");

  if (agentId) {
    return <AgentDetailClient agentId={agentId} />;
  }

  return <AgentDirectoryClient />;
}

export default function AgentPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-zinc-500">Đang tải...</main>}>
      <AgentPageContent />
    </Suspense>
  );
}
