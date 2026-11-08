/**
 * Which preset a visit starts on: the one the address names, else the one
 * shown last, else the default, else the first. Unknown ids are skipped.
 */
export function choosePreset<P extends { id: string }>(
  presets: readonly P[],
  { fromUrl, stored, fallback }: { fromUrl?: string | null; stored?: string | null; fallback?: string },
): P {
  for (const id of [fromUrl, stored, fallback]) {
    const p = id ? presets.find((x) => x.id === id) : undefined;
    if (p) return p;
  }
  return presets[0];
}
