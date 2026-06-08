import { useEffect, useState } from "react";

function carriesFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return types ? Array.prototype.includes.call(types, "Files") : false;
}

export function useFileDrop(onPaths: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;

    const enter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };

    const over = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    const leave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };

    const drop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      const paths = files.map((file) => window.api.getPathForFile(file)).filter((path) => path.length > 0);
      if (paths.length > 0) onPaths(paths);
    };

    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [onPaths]);

  return dragging;
}
