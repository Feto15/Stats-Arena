import { AlertTriangle, SearchX, FileQuestion, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function EmptyState({
  title = "Tidak ada data",
  description = "Pilih kompetisi atau ubah filter untuk melihat data.",
  resetHref,
}: {
  title?: string;
  description?: string;
  resetHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <SearchX className="size-8 text-muted-foreground/60 mb-2" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm">{description}</p>
      {resetHref && (
        <Button asChild variant="outline" size="sm" className="mt-3 h-8">
          <Link href={resetHref}>Reset filter</Link>
        </Button>
      )}
    </div>
  );
}

export function ErrorState({
  message = "Gagal memuat data.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <AlertTriangle className="size-8 text-amber-500 mb-2" />
      <p className="text-sm font-medium">Terjadi kesalahan</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3 h-8" onClick={onRetry}>
          Coba lagi
        </Button>
      )}
    </div>
  );
}

export function NotFoundState({
  title = "Tidak ditemukan",
  description = "ID tidak valid atau data tidak tersedia.",
  backHref = "/",
}: {
  title?: string;
  description?: string;
  backHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <FileQuestion className="size-10 text-muted-foreground/60 mb-3" />
      <p className="text-base font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
      <Button asChild variant="outline" size="sm" className="mt-4 h-8">
        <Link href={backHref}>Kembali</Link>
      </Button>
    </div>
  );
}

export function LoadingBlock({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
      <Loader2 className="size-4 animate-spin" />
      <span className="text-sm">{label ?? "Memuat..."}</span>
    </div>
  );
}
