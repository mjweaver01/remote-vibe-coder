import { useEffect, useState } from "react";
import { IconButton } from "./IconButton.tsx";
import { Bell, BellOff } from "./icons.ts";
import {
  disablePush,
  enablePush,
  getPushState,
  isPushSupported,
  type PushState,
} from "../lib/push.ts";
import { useToast } from "../hooks/useToast.ts";

const INITIAL: PushState = { supported: false, permission: "default", subscribed: false };

export function NotificationsToggle() {
  const [state, setState] = useState<PushState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!isPushSupported()) return;
    let cancelled = false;
    getPushState()
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state.supported && !isPushSupported()) return null;

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (state.subscribed) {
        await disablePush();
        toast.push("success", "Notifications disabled.");
      } else {
        await enablePush();
        toast.push("success", "Notifications enabled.");
      }
      setState(await getPushState());
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Couldn't toggle notifications.");
    } finally {
      setBusy(false);
    }
  };

  const label = state.subscribed
    ? "Notifications: on (click to disable)"
    : state.permission === "denied"
      ? "Notifications blocked in browser settings"
      : "Enable notifications when Claude needs input";

  return (
    <IconButton
      icon={state.subscribed ? Bell : BellOff}
      label={label}
      onClick={onClick}
      disabled={busy || state.permission === "denied"}
    />
  );
}
