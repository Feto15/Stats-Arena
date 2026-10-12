import { cn } from "@/lib/utils";

/**
 * Lightweight bordered section. 8px radius, no card-in-card nesting.
 * Use for every data block on a page.
 */
export function SectionCard({
  title,
  description,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border bg-card overflow-hidden flex flex-col",
        className
      )}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b">
          <div className="min-w-0">
            {title && (
              <h3 className="text-sm font-semibold leading-tight truncate">{title}</h3>
            )}
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
