import { cn } from "@/lib/utils";
import { SectionCard } from "./section-card";
import { DefinitionTooltip } from "./definition-tooltip";

export interface KpiCardProps {
  label: React.ReactNode;
  value: string;
  hint?: string;
  definition?: string;
  icon?: React.ReactNode;
  accent?: "neutral" | "positive" | "negative" | "info";
  badge?: React.ReactNode;
  className?: string;
}

const accentValue: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  neutral: "text-foreground",
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-400",
  info: "text-cyan-600 dark:text-cyan-400",
};

export function KpiCard({
  label,
  value,
  hint,
  definition,
  icon,
  accent = "neutral",
  badge,
  className,
}: KpiCardProps) {
  return (
    <SectionCard className={cn("p-0", className)}>
      <div className="p-3.5 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
            {definition && <DefinitionTooltip label={definition} />}
          </div>
          {badge ? (
            <div className="shrink-0">{badge}</div>
          ) : icon ? (
            <div className="flex size-7 items-center justify-center rounded-md border bg-muted shrink-0 text-muted-foreground">
              {icon}
            </div>
          ) : null}
        </div>
        <p className={cn("text-2xl font-semibold tabular-nums tracking-tight mt-1.5", accentValue[accent])}>
          {value}
        </p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
    </SectionCard>
  );
}
