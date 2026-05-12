'use client';

import { useCallback, useState, type DragEvent } from 'react';

type UseFileDropZoneOptions = {
  onFile: (file: File) => void;
  disabled?: boolean;
  multiple?: boolean;
  onFiles?: (files: File[]) => void;
};

export function useFileDropZone({ onFile, disabled, multiple, onFiles }: UseFileDropZoneOptions) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = useCallback((e: DragEvent<HTMLElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types?.includes('Files')) setIsDragging(true);
  }, [disabled]);

  const handleDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (!isDragging && e.dataTransfer?.types?.includes('Files')) setIsDragging(true);
  }, [disabled, isDragging]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as Node).contains(related)) return;
    setIsDragging(false);
  }, [disabled]);

  const handleDrop = useCallback((e: DragEvent<HTMLElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const list = e.dataTransfer?.files;
    if (!list || list.length === 0) return;
    if (multiple && onFiles) {
      onFiles(Array.from(list));
      return;
    }
    const file = list[0];
    if (file) onFile(file);
  }, [disabled, multiple, onFile, onFiles]);

  return {
    isDragging,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
