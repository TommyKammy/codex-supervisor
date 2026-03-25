import type { SetupReadinessReport } from "../setup-readiness";
import { renderSupervisorDashboardPage } from "./webui-dashboard-page";

export function renderSupervisorDashboardHtml(setupReadiness?: SetupReadinessReport | null): string {
  return renderSupervisorDashboardPage(setupReadiness);
}
