import { renderDashboardBrowserCommandScript } from "./webui-dashboard-browser-command-assets";
import { renderDashboardInjectedHelperScript } from "./webui-dashboard-browser-injected-helpers";
import { renderDashboardBrowserRenderScript } from "./webui-dashboard-browser-render-assets";
import { renderDashboardBrowserStateScript } from "./webui-dashboard-browser-state-assets";

export function renderDashboardBrowserScript(): string {
  return [
    renderDashboardInjectedHelperScript(),
    renderDashboardBrowserStateScript(),
    renderDashboardBrowserRenderScript(),
    renderDashboardBrowserCommandScript(),
  ].join("\n\n");
}
