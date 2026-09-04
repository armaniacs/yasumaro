/**
 * openReport.mjs — desktop auto-open for the generated HTML report.
 * The decision logic is pure (testable, no ambient env reads) — cli.mjs passes
 * process.env.CI / process.stdout.isTTY explicitly. The spawn is best-effort
 * and its failure is advisory only — a bench run never fails because a report
 * could not be opened.
 */
import { spawn } from 'node:child_process';

/**
 * @param {{ noOpen?: boolean, ci?: string | undefined, stdoutIsTTY?: boolean | undefined }} opts
 */
export function shouldAutoOpen({ noOpen = false, ci, stdoutIsTTY } = {}) {
  return !noOpen && !ci && Boolean(stdoutIsTTY);
}

/** Best-effort browser open. Returns false when the spawn throws. */
export function openInBrowser(filePath, platform = process.platform) {
  try {
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', filePath], { detached: true, stdio: 'ignore' }).unref();
    } else {
      const cmd = platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(cmd, [filePath], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}
