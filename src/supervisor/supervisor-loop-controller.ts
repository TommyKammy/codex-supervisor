import type { CliOptions } from "../core/types";
import type { CreateSupervisorServiceOptions } from "./supervisor-service";
import { Supervisor } from "./supervisor";

export interface SupervisorLoopController {
  runCycle: (command: "loop" | "run-once", options: Pick<CliOptions, "dryRun">) => Promise<string>;
}

class SupervisorProcessLoopController implements SupervisorLoopController {
  constructor(
    private readonly supervisor: Pick<Supervisor, "acquireSupervisorLock" | "runOnce">,
  ) {}

  async runCycle(command: "loop" | "run-once", options: Pick<CliOptions, "dryRun">): Promise<string> {
    const lock = await this.supervisor.acquireSupervisorLock(command);
    if (!lock.acquired) {
      return `Skipped supervisor cycle: ${lock.reason ?? "lock unavailable"}.`;
    }

    try {
      return await this.supervisor.runOnce(options);
    } finally {
      await lock.release();
    }
  }
}

export function createSupervisorLoopControllerFromSupervisor(supervisor: Supervisor): SupervisorLoopController {
  return new SupervisorProcessLoopController(supervisor);
}

export function createSupervisorLoopController(
  configPath?: string,
  options: CreateSupervisorServiceOptions = {},
): SupervisorLoopController {
  return createSupervisorLoopControllerFromSupervisor(Supervisor.fromConfig(configPath, options));
}
