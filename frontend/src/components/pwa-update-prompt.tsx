import { useEffect } from "react";
import { toast } from "sonner";
import { useRegisterSW } from "virtual:pwa-register/react";

/** Installed apps can stay open for days; check for a new version hourly. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registers the service worker and, when a new app version has been downloaded,
 * offers a "Reload" action instead of reloading by itself (which could interrupt
 * a form the admin is filling in).
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine) void registration.update();
      }, UPDATE_CHECK_INTERVAL_MS);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    const id = toast("A new version of the app is available.", {
      duration: Infinity,
      action: { label: "Reload", onClick: () => void updateServiceWorker(true) },
      onDismiss: () => setNeedRefresh(false),
    });
    return () => {
      toast.dismiss(id);
    };
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);

  return null;
}
