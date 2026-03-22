export function renderSetupBrowserScript(): string {
  return `
      const elements = {
        overallStatus: document.getElementById("setup-overall-status"),
        summary: document.getElementById("setup-summary"),
        blockers: document.getElementById("setup-blockers"),
        fields: document.getElementById("setup-fields"),
        hostChecks: document.getElementById("setup-host-checks"),
        providerPosture: document.getElementById("setup-provider-posture"),
        trustPosture: document.getElementById("setup-trust-posture"),
      };

      function setText(element, value) {
        if (!element) {
          return;
        }
        element.innerHTML = "";
        element.textContent = value;
      }

      function renderList(element, lines, emptyMessage) {
        if (!element) {
          return;
        }
        element.innerHTML = "";
        const values = Array.isArray(lines) && lines.length > 0 ? lines : [emptyMessage];
        for (const line of values) {
          const item = document.createElement("li");
          item.textContent = line;
          element.appendChild(item);
        }
      }

      async function readJson(path) {
        const response = await fetch(path, { headers: { Accept: "application/json" } });
        if (!response.ok) {
          let message = "Request failed";
          try {
            const body = await response.json();
            message = body.error || message;
          } catch {}
          throw new Error(path + ": " + message);
        }
        return response.json();
      }

      function renderSetup(report) {
        setText(
          elements.overallStatus,
          report.ready ? "configured" : report.overallStatus,
        );
        setText(
          elements.summary,
          "config=" +
            report.configPath +
            " | ready=" +
            (report.ready ? "yes" : "no") +
            " | blockers=" +
            report.blockers.length,
        );
        renderList(
          elements.blockers,
          (report.blockers || []).map((blocker) => blocker.code + " | " + blocker.message),
          "No setup blockers remain. Open /dashboard for steady-state operations.",
        );
        renderList(
          elements.fields,
          (report.fields || []).map(
            (field) =>
              field.label +
              " [" +
              field.state +
              "] " +
              (field.value || "unset") +
              " | source=" +
              field.metadata.source +
              " | type=" +
              field.metadata.valueType,
          ),
          "No setup fields reported.",
        );
        renderList(
          elements.hostChecks,
          ((report.hostReadiness && report.hostReadiness.checks) || []).map(
            (check) => check.name + " [" + check.status + "] " + check.summary,
          ),
          "No host readiness checks reported.",
        );
        setText(elements.providerPosture, report.providerPosture ? report.providerPosture.summary : "No provider posture reported.");
        setText(elements.trustPosture, report.trustPosture ? report.trustPosture.summary : "No trust posture reported.");
      }

      async function bootstrap() {
        try {
          renderSetup(await readJson("/api/setup-readiness"));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setText(elements.overallStatus, "error");
          setText(elements.summary, message);
          renderList(elements.blockers, [message], "No setup blockers reported.");
        }
      }

      void bootstrap();
`;
}
