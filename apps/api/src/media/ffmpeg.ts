import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { setPriority } from "node:os";

/** An ffmpeg we can run, and what it can do. */
export interface Ffmpeg {
  path: string;
  version: string;
  /** Has a WebP encoder (libwebp), which artwork resizing needs. */
  webp: boolean;
}

export class FfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FfmpegError";
  }
}

/** Find ffmpeg. Null if it isn't installed (or `command` doesn't run). */
export async function findFfmpeg(command: string): Promise<Ffmpeg | null> {
  try {
    const { stdout, stderr } = await capture(command, ["-encoders"], 30_000);
    const version = /ffmpeg version (\S+)/.exec(stderr)?.[1] ?? "(unknown version)";
    return { path: command, version, webp: /^\s*V\S*\s+libwebp\s/m.test(stdout) };
  } catch {
    return null;
  }
}

function capture(command: string, args: string[], timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`exit ${code}`))));
  });
}

/**
 * Run ffmpeg without crowding out the server: on one thread, at the lowest CPU priority, and marked as the first
 * thing to stop if memory runs out (free hosting has 0.1 of a CPU and 512 MB). Resolves with what it printed.
 */
export function runFfmpeg(
  ffmpeg: Ffmpeg,
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new FfmpegError("stopped"));
    const child = spawn(
      ffmpeg.path,
      ["-hide_banner", "-nostdin", "-y", "-threads", "1", "-filter_threads", "1", ...args],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    if (child.pid) {
      try {
        setPriority(child.pid, 19);
      } catch {
        // Not allowed here; it still works, just less politely.
      }
      // Linux only. If memory runs out, the kernel stops ffmpeg rather than the server.
      writeFile(`/proc/${child.pid}/oom_score_adj`, "1000").catch(() => undefined);
    }

    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      stderr = (stderr + d).slice(-64_000);
    });
    let why: string | null = null;
    const stop = (reason: string) => {
      why = reason;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(
      () => stop(`took longer than ${Math.round(options.timeoutMs / 1000)} seconds`),
      options.timeoutMs,
    );
    const onAbort = () => stop("stopped");
    options.signal?.addEventListener("abort", onAbort);

    child.on("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (code === 0 && !why) return resolve(stderr);
      const last = stderr.trim().split("\n").slice(-3).join(" | ");
      reject(new FfmpegError(why ? `ffmpeg ${why}` : `ffmpeg failed (exit ${code}): ${last}`));
    });
  });
}
