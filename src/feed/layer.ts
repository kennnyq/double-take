import { Platform, type ViewStyle } from 'react-native';

/**
 * Browsers: gives a view the double take animates its own compositor layer.
 * Reanimated writes its transform or opacity every frame from JS; without a
 * layer of its own, each write repaints everything under it (the video, the
 * blurred poster fill), which made the entrance stutter in Safari.
 */
export const ownLayer: ViewStyle | undefined = Platform.OS === 'web' ? ({ willChange: 'transform, opacity' } as ViewStyle) : undefined;
