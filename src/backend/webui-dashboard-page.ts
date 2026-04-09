import { renderDashboardBrowserScript } from "./webui-dashboard-browser-script";
import { renderDashboardPageLayout } from "./webui-dashboard-page-layout";
import { renderDashboardPageSections } from "./webui-dashboard-page-sections";
import type { SetupReadinessReport } from "../setup-readiness";

export function renderSupervisorDashboardPage(setupReadiness?: SetupReadinessReport | null): string {
  const sections = renderDashboardPageSections(setupReadiness);
  return renderDashboardPageLayout({
    ...sections,
    browserScript: renderDashboardBrowserScript(),
  });
}
