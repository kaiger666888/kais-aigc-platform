/**
 * BGM (background music) detection wrapper.
 *
 * Shells out to scripts/audio/detect_bgm.py which uses inaSpeechSegmenter
 * (CNN) + spectral analysis (flatness, tempo) for cross-validation.
 *
 * The Python venv is expected at /tmp/bgm-detector-venv. If missing, the
 * detector falls back to the system Python and lets the script fail loudly
 * with install instructions.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, "../..");
const DETECT_SCRIPT = path.join(REPO_ROOT, "scripts/audio/detect_bgm.py");
const PYTHON_VENV = process.env.BGM_DETECTOR_VENV
  || path.join(REPO_ROOT, ".venvs/bgm-detector/bin/python3");
const PYTHON_FALLBACK = process.env.BGM_DETECTOR_PYTHON || "python3";

export interface BgmReport {
  has_bgm: boolean;
  confidence: number;
  music_pct: number;
  speech_pct: number;
  noise_pct: number;
  silence_pct: number;
  spectral_flatness: number;
  tempo_bpm: number;
  tempo_strength: number;
  interpretation: "MUSIC" | "NOISE/AMBIENT" | "MIXED" | "SILENT";
  duration_s: number;
  segments: Array<[string, number, number]>;
  input: string;
  method_agreement?: { cnn_flag: boolean; spectral_flag: boolean };
  note?: string;
}

function pickPython(): string {
  // Prefer venv if present; otherwise fall back and let the error surface.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    if (fs.existsSync(PYTHON_VENV)) return PYTHON_VENV;
  } catch { /* ignore */ }
  return PYTHON_FALLBACK;
}

/**
 * Run BGM detection on a local file path (video or audio).
 * Returns null if the file has no audio stream (silent video).
 */
export async function detectBgm(
  filePath: string,
  opts: { threshold?: number; timeoutMs?: number } = {},
): Promise<BgmReport> {
  const threshold = opts.threshold ?? 0.10;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const python = pickPython();

  const args = [
    DETECT_SCRIPT,
    filePath,
    "--threshold", String(threshold),
    "--json",
  ];

  let stdout: string;
  let stderr: string;
  try {
    const result = await execFileAsync(python, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, TF_CPP_MIN_LOG_LEVEL: "3" },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: any) {
    // The script exits with code 1 when BGM is detected (for CLI use).
    //stdout/stderr are still populated.
    if (err.stdout) {
      stdout = err.stdout;
      stderr = err.stderr || "";
    } else {
      throw new Error(
        `detect_bgm.py failed: ${err.message}\n` +
        (err.stderr ? `stderr: ${err.stderr.slice(0, 500)}` : ""),
      );
    }
  }

  // Filter Keras/TF log lines that leak into stdout occasionally
  const jsonStart = stdout.indexOf("{");
  const jsonEnd = stdout.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(
      `detect_bgm.py did not return JSON. stderr=${stderr.slice(0, 500)}`,
    );
  }
  const jsonStr = stdout.slice(jsonStart, jsonEnd + 1);
  return JSON.parse(jsonStr) as BgmReport;
}
