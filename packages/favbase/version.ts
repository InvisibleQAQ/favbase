/**
 * The one version primitive the CLI acts on (docs/27 Step 2). It understands
 * plain `MAJOR.MINOR.PATCH` releases only; a dev build (`0.0.0-dev`), a test
 * fixture (`test`), a prerelease or an empty string is not comparable. Callers
 * treat `null` as "do nothing" -- that rule is what keeps unreleased builds from
 * replacing daemons or announcing updates.
 */
const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseRelease(version: string): [number, number, number] | null {
  const match = RELEASE.exec(version);
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return parts.every(Number.isSafeInteger) ? [...parts] : null;
}

export function isReleaseVersion(version: string): boolean {
  return parseRelease(version) !== null;
}

/** -1 when `a` is older than `b`, 1 when newer, 0 when equal, `null` when either is not a release. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseRelease(a);
  const right = parseRelease(b);
  if (!left || !right) return null;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}
