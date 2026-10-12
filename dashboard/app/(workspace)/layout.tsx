import { AppShell } from "@/components/shell/app-shell";
import { readCompetitionOptions } from "@/lib/data/server";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
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
