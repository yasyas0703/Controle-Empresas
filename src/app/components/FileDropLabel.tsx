'use client';

import React, { type ReactNode } from 'react';
import { useFileDropZone } from '@/app/hooks/useFileDropZone';

type FileDropLabelProps = {
  onFile: (file: File) => void;
  accept?: string;
  disabled?: boolean;
  className?: string;
  draggingClassName?: string;
  inputClassName?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  title?: string;
  /** Children pode ser uma função que recebe { isDragging } para renderizar conteúdo dinâmico */
  children: ReactNode | ((state: { isDragging: boolean }) => ReactNode);
};

/**
 * Label clicável que também aceita drag-and-drop. Substitui labels que envolvem
 * <input type="file" hidden /> em modais de envio de documentos.
 */
export default function FileDropLabel({
  onFile,
  accept,
  disabled,
  className,
  draggingClassName,
  inputClassName = 'hidden',
  inputRef,
  title,
  children,
}: FileDropLabelProps) {
  const { isDragging, dragHandlers } = useFileDropZone({ onFile, disabled });

  const combined = isDragging && draggingClassName
    ? `${className ?? ''} ${draggingClassName}`
    : className;

  return (
    <label className={combined} title={title} {...dragHandlers}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className={inputClassName}
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      {typeof children === 'function' ? children({ isDragging }) : children}
    </label>
  );
}
