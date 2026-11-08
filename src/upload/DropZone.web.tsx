import { useState, type PropsWithChildren } from 'react';
import type { DocumentPickerAsset } from 'expo-document-picker';
export function DropZone({ children, onFile }: PropsWithChildren<{ onFile: (asset: DocumentPickerAsset) => void }>) {
  const [over, setOver] = useState(false);
  return <div onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => {
    e.preventDefault(); setOver(false); const file = e.dataTransfer.files[0];
    if (file) onFile({ file, lastModified: file.lastModified, uri: '', name: file.name, size: file.size, mimeType: file.type });
  }} style={{ border: '1px dashed currentColor', borderRadius: 16, background: over ? '#ffffff18' : 'transparent', transition: 'background 180ms ease', color: '#888', padding: 28 }}>{children}</div>;
}
