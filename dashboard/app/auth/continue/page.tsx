import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth/server";
import { loginDestination } from "@/lib/auth/policy";
import type { DashboardSearchParams } from "@/lib/competition-scope";
export default async function ContinuePage({searchParams}:{searchParams:Promise<DashboardSearchParams>}) {
  const viewer = await requireViewer();
  redirect(loginDestination(viewer.isAdmin,(await searchParams)["next"]));
}
