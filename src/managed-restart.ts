export type ManagedRestartLauncher = "launchd" | "systemd" | "custom";

export interface ManagedRestartCapability {
  supported: boolean;
  launcher: ManagedRestartLauncher | null;
  state: "ready" | "reconnecting" | "unavailable";
  summary: string;
}

export interface ManagedRestartController {
  capability: ManagedRestartCapability;
  requestRestart: () => Promise<ManagedRestartCommandResultDto>;
}

export interface ManagedRestartCommandResultDto {
  command: "managed-restart";
  accepted: true;
  summary: string;
}

export function unavailableManagedRestartCapability(): ManagedRestartCapability {
  return {
    supported: false,
    launcher: null,
    state: "unavailable",
    summary: "Managed restart is unavailable because this WebUI process was not started with explicit launcher-backed restart support.",
  };
}

export function readManagedRestartCapabilityFromEnv(env: NodeJS.ProcessEnv): ManagedRestartCapability | null {
  const enabled = env.CODEX_SUPERVISOR_MANAGED_RESTART;
  const launcher = parseManagedRestartLauncher(env.CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER);
  if (!isExplicitlyEnabled(enabled) || launcher === null) {
    return null;
  }

  return {
    supported: true,
    launcher,
    state: "ready",
    summary: `Managed restart is available through the ${launcher} launcher.`,
  };
}

export function createManagedRestartControllerFromEnv(args: {
  env: NodeJS.ProcessEnv;
  requestStop: () => Promise<void>;
}): ManagedRestartController | null {
  const capability = readManagedRestartCapabilityFromEnv(args.env);
  if (!capability) {
    return null;
  }

  return {
    capability,
    requestRestart: async () => {
      setImmediate(() => {
        void args.requestStop();
      });
      return {
        command: "managed-restart",
        accepted: true,
        summary: `Managed restart requested through the ${capability.launcher} launcher. This WebUI process will exit for relaunch.`,
      };
    },
  };
}

function isExplicitlyEnabled(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function parseManagedRestartLauncher(value: string | undefined): ManagedRestartLauncher | null {
  return value === "launchd" || value === "systemd" || value === "custom" ? value : null;
}
