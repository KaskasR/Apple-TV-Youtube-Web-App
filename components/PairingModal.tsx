import type { FormEvent } from "react";

type PairingModalProps = {
  code: string;
  onCodeChange: (code: string) => void;
  onSubmit: (e: FormEvent) => void;
  isPairing: boolean;
  errorMessage: string | null;
};

export default function PairingModal({
  code,
  onCodeChange,
  onSubmit,
  isPairing,
  errorMessage,
}: PairingModalProps) {
  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-xs flex-col gap-3">
      <label htmlFor="code" className="text-lg text-white">
        Enter the TV code from YouTube → Settings → Link with TV code
      </label>
      <input
        id="code"
        value={code}
        onChange={(e) => onCodeChange(e.target.value)}
        className="rounded-lg border border-white/30 bg-black px-4 py-3 text-xl text-white"
        placeholder="123456"
        inputMode="numeric"
      />
      <button
        type="submit"
        disabled={isPairing || !code}
        className="min-h-[56px] rounded-lg bg-white px-6 py-3 text-xl font-semibold text-black disabled:opacity-50"
      >
        {isPairing ? "Pairing…" : "Pair"}
      </button>
      {errorMessage && <p className="text-red-400">{errorMessage}</p>}
    </form>
  );
}
