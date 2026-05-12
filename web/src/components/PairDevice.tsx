import { useEffect, useState } from "react";
import { hasStoredToken, signOut, withToken } from "../lib/auth.ts";
import { useAsync } from "../hooks/useAsync.ts";
import { fetchPairingUrl } from "../lib/api.ts";
import { QrCode, X } from "./icons.ts";

export function PairDeviceButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        title="Pair another device"
        aria-label="Pair another device"
        onClick={() => setOpen(true)}
      >
        <QrCode size={18} aria-hidden="true" />
      </button>
      {open ? <PairDeviceModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PairDeviceModal({ onClose }: { onClose: () => void }) {
  const { data } = useAsync((signal) => fetchPairingUrl(signal), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const displayUrl = data?.url ?? window.location.origin;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Pair a device</div>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body pair-modal-body">
          <img src={withToken("/api/qr")} alt="Pairing QR code" className="pair-qr" />
          <p className="pair-instructions">
            Open the <strong>Remote Vibe Coder</strong> app on your phone or tablet and scan this
            code, or visit:
          </p>
          <code className="pair-url">{displayUrl}</code>
          {hasStoredToken() ? (
            <button
              type="button"
              className="pair-signout"
              onClick={() => {
                if (window.confirm("Sign out of this device? You'll need to re-pair with a QR or token URL.")) {
                  signOut();
                }
              }}
            >
              Sign out of this device
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
