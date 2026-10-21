import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Stands in for the OS keychain: "encryption" is reversible only while the key is unchanged.
const keychain = { available: true, backend: "gnome_libsecret", key: "k1", failWrites: false };
let disk: Record<string, string> = {};

// Module mocks are shared by the whole test run, so the other Electron exports tests use stay available.
mock.module("electron", () => ({
  shell: { openExternal: async () => undefined },
  safeStorage: {
    isEncryptionAvailable: () => keychain.available,
    getSelectedStorageBackend: () => keychain.backend,
    encryptString: (value: string) => Buffer.from(`${keychain.key}|${value}`),
    decryptString: (buffer: Buffer) => {
      if (!keychain.available) throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString. Encryption is not available.");
      const [key, ...rest] = buffer.toString().split("|");
      if (key !== keychain.key) throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
      return rest.join("|");
    },
  },
}));
mock.module("./store", () => ({
  readJson: <T>(_file: string, fallback: T): T => (Object.keys(disk).length ? (structuredClone(disk) as T) : fallback),
  writeJson: (_file: string, value: Record<string, string>) => {
    if (keychain.failWrites) throw new Error("ENOSPC");
    disk = structuredClone(value);
  },
}));

// A fresh copy per test file run: other tests replace the secrets module with an in-memory stand-in.
const secrets = await import(`./secrets.ts?real=${Date.now()}`) as typeof import("./secrets");

const realWarn = console.warn;
beforeEach(() => {
  console.warn = () => undefined;
});
afterEach(() => {
  console.warn = realWarn;
  Object.assign(keychain, { available: true, backend: "gnome_libsecret", key: "k1", failWrites: false });
  for (const name of Object.keys(disk)) secrets.deleteSecret(name);
});

describe("secrets", () => {
  test("round-trips a value without storing it in clear text", () => {
    secrets.setSecret("stream-key:a", "live_123");
    expect(JSON.stringify(disk)).not.toContain("live_123");
    expect(secrets.getSecret("stream-key:a")).toBe("live_123");
    expect(secrets.hasSecret("stream-key:a")).toBe(true);
  });

  test("refuses to save when the OS offers no real encryption", () => {
    keychain.available = false;
    expect(() => secrets.setSecret("stream-key:a", "x")).toThrow("secure-storage-unavailable");
    keychain.available = true;
    if (process.platform === "linux") {
      keychain.backend = "basic_text";
      expect(() => secrets.setSecret("stream-key:a", "x")).toThrow("secure-storage-unavailable");
    }
    expect(secrets.hasSecret("stream-key:a")).toBe(false);
  });

  test("keeps a stored value while secure storage is temporarily locked", () => {
    secrets.setSecret("oauth:twitch:1", "token");
    keychain.available = false;
    expect(() => secrets.getSecret("oauth:twitch:1")).toThrow("secure-storage-locked");
    expect(secrets.hasSecret("oauth:twitch:1")).toBe(true);
    keychain.available = true;
    expect(secrets.getSecret("oauth:twitch:1")).toBe("token");
  });

  test("drops a value whose OS key changed, so the user is asked again", () => {
    secrets.setSecret("oauth:twitch:1", "token");
    keychain.key = "k2";
    expect(secrets.getSecret("oauth:twitch:1")).toBeNull();
    expect(secrets.hasSecret("oauth:twitch:1")).toBe(false);
  });

  test("a failed write leaves the remembered secrets unchanged", () => {
    secrets.setSecret("stream-key:a", "one");
    keychain.failWrites = true;
    expect(() => secrets.setSecret("stream-key:a", "two")).toThrow("ENOSPC");
    expect(() => secrets.setSecret("stream-key:b", "three")).toThrow("ENOSPC");
    keychain.failWrites = false;
    expect(secrets.getSecret("stream-key:a")).toBe("one");
    expect(secrets.hasSecret("stream-key:b")).toBe(false);
  });
});
