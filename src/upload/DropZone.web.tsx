import { useRef } from 'react';
import type { DropZoneProps } from './DropZone';

/** Fills its parent and takes a file dropped anywhere on it. */
export function DropZone({ children, onFile, onOver }: DropZoneProps) {
  // dragenter/dragleave fire for every child crossed; count them so `over` stays steady.
  const depth = useRef(0);
  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        if (depth.current++ === 0) onOver?.(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        if (--depth.current <= 0) {
          depth.current = 0;
          onOver?.(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        onOver?.(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile({ file, lastModified: file.lastModified, uri: '', name: file.name, size: file.size, mimeType: file.type });
      }}
      style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
    >
      {children}
    </div>
  );
}
