"use client";

import { ErrorState } from "@/components/dashboard-ui/states";
import { SectionCard } from "@/components/dashboard-ui/section-card";

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-4 sm:p-6">
      <SectionCard title="Halaman tidak dapat dimuat">
        <ErrorState
          message="Terjadi kendala saat menampilkan halaman. Coba muat ulang bagian ini."
          onRetry={reset}
        />
      </SectionCard>
    </div>
  );
}
