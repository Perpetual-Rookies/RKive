import { spawn } from "node:child_process";
import path from "node:path";

export type IngestResult =
  | { ok: true; chunks: number }
  | { ok: false; error: string };

export function runIngestScript(args: {
  scriptsRoot: string;
  filePath: string;
  documentId: string;
  env: NodeJS.ProcessEnv;
}): Promise<IngestResult> {
  return new Promise((resolve) => {
    const uv = process.env.UV_PATH ?? "uv";
    const proc = spawn(
      uv,
      [
        "run",
        "python",
        "-m",
        "rkive_ingest",
        "ingest",
        args.filePath,
        "--document-id",
        args.documentId,
      ],
      {
        cwd: args.scriptsRoot,
        env: { ...process.env, ...args.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: stderr.trim() || `exit ${code}`,
        });
        return;
      }
      const line = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      if (!line) {
        resolve({ ok: true, chunks: 0 });
        return;
      }
      try {
        const j = JSON.parse(line) as { chunks?: number };
        resolve({ ok: true, chunks: j.chunks ?? 0 });
      } catch {
        resolve({ ok: true, chunks: 0 });
      }
    });
  });
}

export function defaultScriptsRoot(): string {
  const fromEnv = process.env.SCRIPTS_ROOT;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), "..", "scripts");
}
