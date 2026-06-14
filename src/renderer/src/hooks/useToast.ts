import { useEffect, useState } from "react";
import { TOAST_DURATION_MS, type ToastDuration } from "@shared/schemas/settings";

export interface ToastController {
  toast: string | null;
  notify: (message: string) => void;
}

export function useToast(duration: ToastDuration): ToastController {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (toast === null) return;
    const handle = window.setTimeout(() => setToast(null), TOAST_DURATION_MS[duration]);
    return () => window.clearTimeout(handle);
  }, [toast, duration]);

  return { toast, notify: setToast };
}
