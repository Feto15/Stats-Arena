"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter } from "lucide-react";
import type { CompetitionOption } from "@/lib/data/contracts";

export function CompetitionFilter({
  competitions,
  unavailable,
}: {
  competitions: CompetitionOption[];
  unavailable: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const competitionValues = searchParams.getAll("competition");
  const current = competitionValues.length === 1 ? competitionValues[0] ?? "" : "";
  const knownCurrent = competitions.some((competition) => competition.sourceCompetitionId === current);
  const value = knownCurrent ? current : "";

  function selectCompetition(nextValue: string) {
    const params = new URLSearchParams(searchParams.toString());
    // Group/team IDs and pagination belong to the previous competition.
    for (const key of ["group", "team", "page", "scope"]) params.delete(key);
    params.delete("competition");
    if (nextValue) params.set("competition", nextValue);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const placeholder = unavailable
    ? "Pilihan belum tersedia"
    : competitionValues.length > 1
      ? "Parameter kompetisi berulang"
      : current && !knownCurrent
        ? "Kompetisi tidak ditemukan"
        : "Pilih kompetisi";

  return (
    <label className="relative flex h-8 min-w-36 items-center sm:min-w-56">
      <Filter className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Pilih kompetisi</span>
      <select
        aria-label="Pilih kompetisi"
        value={value}
        disabled={unavailable || competitions.length === 0}
        onChange={(event) => selectCompetition(event.target.value)}
        className="h-full w-full appearance-none rounded-md border border-input bg-background pl-8 pr-7 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      >
        <option value="">{placeholder}</option>
        {current && !knownCurrent && !unavailable && <option value={current}>{`ID ${current} · tidak ditemukan`}</option>}
        {competitions.map((competition) => {
          const metadata = [competition.season, competition.year === null ? null : String(competition.year)]
            .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
            .join(" · ");
          return <option key={competition.id} value={competition.sourceCompetitionId}>
            {`${competition.name}${metadata ? ` · ${metadata}` : ""} · ${competition.sourceCompetitionId}`}
          </option>;
        })}
      </select>
    </label>
  );
}
