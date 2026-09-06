import { runInstallerCli } from "../plugins/pstack/skills/poteto-mode/scripts/install.ts";

process.exitCode = runInstallerCli(process.argv.slice(2));
