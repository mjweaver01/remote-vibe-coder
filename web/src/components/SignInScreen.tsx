import { useState, type FormEvent } from "react";
import { KeyRound } from "./icons.ts";
import { setToken } from "../lib/auth.ts";

export function SignInScreen() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const saved = setToken(value);
    if (!saved) {
      setError("Paste a pairing URL or token.");
      return;
    }
    window.location.assign("/");
  };

  return (
    <main className="page page-signin">
      <div className="signin-card">
        <div className="signin-icon" aria-hidden="true">
          <KeyRound size={28} />
        </div>
        <h1 className="signin-title">Pair this device</h1>
        <p className="signin-desc">
          This server requires a pairing token. Scan the QR from the laptop terminal, or paste the
          full pairing URL below.
        </p>
        <form className="signin-form" onSubmit={onSubmit}>
          <input
            type="text"
            className="signin-input"
            placeholder="https://…/?token=… or token"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {error ? <div className="signin-error">{error}</div> : null}
          <button type="submit" className="btn primary big">
            Connect
          </button>
        </form>
      </div>
    </main>
  );
}
