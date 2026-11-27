"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import VideoStudio from "@/components/VideoStudio";

function StudioInner() {
  const id = useSearchParams().get("id");
  if (!id) {
    return (
      <main className="mx-auto max-w-lg p-10 text-center text-sm text-zinc-400">
        Thiếu tham số <code>?id=</code>. Hãy mở Studio từ trang Agent quản lý video.
      </main>
    );
  }
  return <VideoStudio videoId={id} />;
}

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioInner />
    </Suspense>
  );
}
