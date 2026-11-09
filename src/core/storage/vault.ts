import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Encrypted document store. In the app every value is a JSON document encrypted
 * by Rust (`src-tauri/src/vault.rs`); outside Tauri (browser preview, tests) it
 * falls back to an unencrypted in-memory or localStorage store.
 *
 * Namespace and key names: 1–128 chars of `[A-Za-z0-9._-]`, not starting with ".".
 * The `secrets` namespace is reserved for Rust and rejected here.
 */
export interface Vault {
  get<T>(ns: string, key: string): Promise<T | null>;
  put<T>(ns: string, key: string, value: T): Promise<void>;
  delete(ns: string, key: string): Promise<void>;
  /** Sorted keys in a namespace. */
  list(ns: string): Promise<string[]>;
  /** Deletes one namespace, or with no argument all data and the master key. */
  wipe(ns?: string): Promise<void>;
  status(): Promise<VaultStatus>;
}

export interface VaultStatus {
  /** False when the master key could not be put in the OS credential store. */
  protected: boolean;
}

/** Typed view over one namespace. */
export interface VaultCollection<T> {
  get(key: string): Promise<T | null>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
  clear(): Promise<void>;
}

export const RESERVED_NAMESPACE = "secrets";
const NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

export function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

function check(ns: string, key?: string): void {
  if (!isValidName(ns)) throw new Error(`名称不合法：“${ns}”`);
  if (ns === RESERVED_NAMESPACE) throw new Error("该命名空间仅供内部使用");
  if (key !== undefined && !isValidName(key)) throw new Error(`名称不合法：“${key}”`);
}

export function createTauriVault(): Vault {
  return {
    get: <T>(ns: string, key: string) => invoke<T | null>("vault_get", { ns, key }),
    put: (ns, key, value) => invoke("vault_put", { ns, key, value: value ?? null }),
    delete: (ns, key) => invoke("vault_delete", { ns, key }),
    list: (ns) => invoke("vault_list", { ns }),
    wipe: (ns) => invoke("vault_wipe", { ns: ns ?? null }),
    status: () => invoke("vault_status"),
  };
}

/** Minimal subset of the Web Storage API, so tests can pass a fake. */
export type KeyValueStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

/**
 * Unencrypted development store. Values round-trip through JSON like the real
 * vault, so callers cannot accidentally depend on object identity.
 */
export function createLocalVault(storage?: KeyValueStorage, prefix = "memory-pet:vault:"): Vault {
  const memory = new Map<string, string>();
  const backend = storage ?? {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size;
    },
  };
  const id = (ns: string, key: string) => `${prefix}${ns}/${key}`;
  const allKeys = () => {
    const keys: string[] = [];
    for (let i = 0; i < backend.length; i++) {
      const k = backend.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
    return keys;
  };

  return {
    async get<T>(ns: string, key: string) {
      check(ns, key);
      const raw = backend.getItem(id(ns, key));
      return raw === null ? null : (JSON.parse(raw) as T);
    },
    async put<T>(ns: string, key: string, value: T) {
      check(ns, key);
      backend.setItem(id(ns, key), JSON.stringify(value ?? null));
    },
    async delete(ns, key) {
      check(ns, key);
      backend.removeItem(id(ns, key));
    },
    async list(ns) {
      check(ns);
      const head = `${prefix}${ns}/`;
      return allKeys()
        .filter((k) => k.startsWith(head))
        .map((k) => k.slice(head.length))
        .sort();
    },
    async wipe(ns) {
      if (ns !== undefined) check(ns);
      const head = ns === undefined ? prefix : `${prefix}${ns}/`;
      for (const k of allKeys()) if (k.startsWith(head)) backend.removeItem(k);
    },
    async status() {
      return { protected: false };
    },
  };
}

function defaultVault(): Vault {
  if (isTauri()) return createTauriVault();
  return createLocalVault(typeof localStorage === "undefined" ? undefined : localStorage);
}

let shared: Vault | undefined;

/** The app-wide vault: Rust-backed in Tauri, localStorage-backed in a plain browser. */
export function getVault(): Vault {
  shared ??= defaultVault();
  return shared;
}

export function collection<T>(ns: string, vault: Vault = getVault()): VaultCollection<T> {
  return {
    get: (key) => vault.get<T>(ns, key),
    put: (key, value) => vault.put(ns, key, value),
    delete: (key) => vault.delete(ns, key),
    list: () => vault.list(ns),
    clear: () => vault.wipe(ns),
  };
}
