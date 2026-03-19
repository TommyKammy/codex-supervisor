import { isDirectExecution, runCliMain } from "./cli/entrypoint";
export { parseArgs } from "./cli/parse-args";

if (isDirectExecution(process.argv[1], __filename)) {
  void runCliMain(process.argv.slice(2));
}
