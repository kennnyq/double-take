import type { PropsWithChildren } from 'react';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { View } from 'react-native';
export function DropZone({ children }: PropsWithChildren<{ onFile: (asset: DocumentPickerAsset) => void }>) { return <View>{children}</View>; }
