import { Asset } from 'expo-asset';

/**
 * A URL for a clip's video or poster: remote clips carry `{ uri }`, bundled
 * placeholders are asset modules (`require(...)`), resolved through expo-asset.
 */
export function mediaUri(source: unknown): string | undefined {
  if (source == null) return undefined;
  if (typeof source === 'string') return source;
  if (typeof source === 'number') return Asset.fromModule(source).uri;
  if (typeof source === 'object' && 'uri' in source && typeof source.uri === 'string') return source.uri;
  return undefined;
}
