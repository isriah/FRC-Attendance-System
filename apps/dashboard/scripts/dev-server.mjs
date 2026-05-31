import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = resolve(dashboardRoot, "node_modules/vite/bin/vite.js");
const allowedHost = process.env.VITE_ALLOWED_HOST ?? "attkiosk";

const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
  cwd: dashboardRoot,
  env: {
    ...process.env,
    __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: allowedHost
  },
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
