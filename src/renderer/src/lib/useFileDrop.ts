import { useEffect, useRef, useState } from "react";

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

export function useFileDrop(onDrop: (files: File[]) => void): boolean {
  const [active, setActive] = useState(false);
  const depthRef = useRef(0);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    const reset = (): void => {
      depthRef.current = 0;
      setActive(false);
    };
    const onDragEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depthRef.current += 1;
      setActive(true);
    };
    const onDragOver = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setActive(false);
    };
    const onDropEvent = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      reset();
      const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
      if (files.length > 0) onDropRef.current(files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDropEvent);
    window.addEventListener("dragend", reset);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDropEvent);
      window.removeEventListener("dragend", reset);
    };
  }, []);

  return active;
}
