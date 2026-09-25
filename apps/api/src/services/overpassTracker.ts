const OVERPASS_FAIL_THRESHOLD = Number(process.env.OVERPASS_FAIL_THRESHOLD || 2);

let failureCount = 0;
let localOnly = false;

function refreshLocalOnly(): void {
  if (failureCount >= OVERPASS_FAIL_THRESHOLD) {
    localOnly = true;
  }
}

export function recordFail(): void {
  failureCount += 1;
  refreshLocalOnly();
  console.log(
    `[overpass-tracker] fail #${failureCount}${localOnly ? ' → localOnly mode' : ''}`,
  );
}

export function recordSuccess(): void {
  if (failureCount > 0 || localOnly) {
    failureCount = 0;
    localOnly = false;
  }
}

export function reset(): void {
  failureCount = 0;
  localOnly = false;
}

export function isLocalOnly(): boolean {
  if (process.env.RAIL_LOCAL_ONLY_MODE === '1') return true;
  const mode = String(process.env.RAIL_OVERPASS ?? '1').trim().toLowerCase();
  if (mode === '0') return true;
  return localOnly;
}

export function getFailureCount(): number {
  return failureCount;
}