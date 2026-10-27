import { AppShell } from "@/components/shell/app-shell";
import { readCompetitionOptions } from "@/lib/data/server";
import { requireAdmin } from "@/lib/auth/server";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const options = await readCompetitionOptions();
  return (
    <AppShell
      competitions={options.data}
      competitionsUnavailable={options.status === "unavailable"}
    >
      {children}
    </AppShell>
  );
}
