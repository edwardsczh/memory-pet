import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONSENT_VERSION,
  createLocalConsentStore,
  isConsentCurrent,
  type ConsentStore,
  type FirstRunConsentRecord,
} from "./consentStore";

export type ConsentStatus = "loading" | "required" | "accepted";

export interface FirstRunConsentState {
  status: ConsentStatus;
  record: FirstRunConsentRecord | null;
  accept(input: { ageAdult: boolean }): Promise<void>;
  /** Withdraw consent; the first-run page shows again. */
  revoke(): Promise<void>;
}

export function useFirstRunConsent(store?: ConsentStore): FirstRunConsentState {
  const s = useMemo(() => store ?? createLocalConsentStore(), [store]);
  const [record, setRecord] = useState<FirstRunConsentRecord | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    s.load()
      .catch(() => null)
      .then((r) => {
        if (!alive) return;
        setRecord(r);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [s]);

  const accept = useCallback(
    async ({ ageAdult }: { ageAdult: boolean }) => {
      const r = { version: CONSENT_VERSION, acceptedAt: Date.now(), ageAdult };
      await s.save(r);
      setRecord(r);
    },
    [s],
  );

  const revoke = useCallback(async () => {
    await s.clear();
    setRecord(null);
  }, [s]);

  const status: ConsentStatus = !loaded
    ? "loading"
    : isConsentCurrent(record)
      ? "accepted"
      : "required";
  return { status, record, accept, revoke };
}
