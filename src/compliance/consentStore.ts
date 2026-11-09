/** Bump when the first-run notice changes materially; users then see it again. */
export const CONSENT_VERSION = 1;

export interface FirstRunConsentRecord {
  version: number;
  acceptedAt: number;
  /** "我已年满 18 周岁". False blocks companion / family roles. */
  ageAdult: boolean;
}

/** Async so it can be swapped for the encrypted Tauri store later. */
export interface ConsentStore {
  load(): Promise<FirstRunConsentRecord | null>;
  save(record: FirstRunConsentRecord): Promise<void>;
  clear(): Promise<void>;
}

const KEY = "memory-pet.first-run-consent";

function parse(raw: string | null): FirstRunConsentRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<FirstRunConsentRecord>;
    if (typeof v.version !== "number" || typeof v.acceptedAt !== "number") return null;
    return { version: v.version, acceptedAt: v.acceptedAt, ageAdult: v.ageAdult === true };
  } catch {
    return null;
  }
}

export function createLocalConsentStore(storage: Storage = window.localStorage): ConsentStore {
  return {
    load: async () => parse(storage.getItem(KEY)),
    save: async (record) => storage.setItem(KEY, JSON.stringify(record)),
    clear: async () => storage.removeItem(KEY),
  };
}

export function isConsentCurrent(record: FirstRunConsentRecord | null): boolean {
  return record !== null && record.version === CONSENT_VERSION;
}
