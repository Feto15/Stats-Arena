import { describeReviewImpact, type ReviewImpactInput } from "@/lib/data/review-impact";

export function ReviewImpact({ issue, historical = false }: { issue: ReviewImpactInput; historical?: boolean }) {
  const impact = describeReviewImpact(issue);
  return <div className="mt-2 rounded-md border bg-muted/40 p-2 text-xs">
    <p className="font-medium">{historical ? "Dampak saat pemeriksaan" : "Dampak"} · {impact.scope}</p>
    <p className="mt-1 text-muted-foreground">{impact.description}</p>
  </div>;
}
