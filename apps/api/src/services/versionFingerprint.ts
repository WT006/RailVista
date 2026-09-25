import { execSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORRIDOR_DIR = join(__dirname, '../../../../data/presets/corridors');

export type VersionFingerprint = {
  commit: string;
  corridorCount: number;
  buildTime: string;
};

function shortCommit(): string {
  const env = process.env.RAILVISTA_COMMIT;
  if (env && env.trim()) return env.trim().slice(0, 7);
  try {
    const out = execSync('git rev-parse --short HEAD', { encoding: 'utf8', timeout: 2000 }).trim();
    return out.slice(0, 7);
  } catch {
    return 'unknown';
  }
}

function countCorridors(): number {
  try {
    if (!existsSync(CORRIDOR_DIR)) return 0;
    const files = readdirSync(CORRIDOR_DIR);
    return files.filter((f) => f.endsWith('.json') && !f.startsWith('_')).length;
  } catch {
    return 0;
  }
}

export function buildVersionFingerprint(): VersionFingerprint {
  return {
    commit: shortCommit(),
    corridorCount: countCorridors(),
    buildTime: new Date().toISOString(),
  };
}