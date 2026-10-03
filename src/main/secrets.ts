// Stream keys and OAuth tokens, encrypted with the OS keychain (macOS
// Keychain / Windows DPAPI) through Electron safeStorage. Values never leave
// the main process and are never logged.

import { safeStorage } from "electron";
import { readJson, writeJson } from "./store";

const FILE = "secrets.json";

type SecretFile = Record<string, string>;

let cache: SecretFile | null = null;

function load(): SecretFile {
  cache ??= readJson<SecretFile>(FILE, {});
  return cache;
}

function save(file: SecretFile): void {
  writeJson(FILE, file);
  cache = file;
}

export function secureStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function setSecret(name: string, value: string): void {
  if (!secureStorageAvailable()) throw new Error("secure-storage-unavailable");
  const file = load();
  file[name] = safeStorage.encryptString(value).toString("base64");
  save(file);
}

export function getSecret(name: string): string | null {
  const encrypted = load()[name];
  if (!encrypted) return null;
  return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
}

export function hasSecret(name: string): boolean {
  return Boolean(load()[name]);
}

export function deleteSecret(name: string): void {
  const file = load();
  if (!(name in file)) return;
  delete file[name];
  save(file);
}

export const secretNames = {
  streamKey: (destinationId: string) => `stream-key:${destinationId}`,
  token: (accountId: string) => `oauth:${accountId}`,
};
