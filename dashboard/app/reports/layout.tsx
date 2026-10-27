import "../auth.css";
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  // Each data-producing page checks its own session/scope so redirects preserve the requested report.
  return children;
}
