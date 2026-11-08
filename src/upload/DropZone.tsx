import type { PropsWithChildren } from 'react';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { StyleSheet, View } from 'react-native';

export type DropZoneProps = PropsWithChildren<{
  onFile: (asset: DocumentPickerAsset) => void;
  /** Whether a dragged file is over the zone (web only). */
  onOver?: (over: boolean) => void;
}>;

/** Fills its parent. Phones and tablets have no drag and drop: a plain view. */
export function DropZone({ children }: DropZoneProps) {
  return <View style={StyleSheet.absoluteFill}>{children}</View>;
}
