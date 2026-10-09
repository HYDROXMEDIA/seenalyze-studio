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
  if (!safeStorage.isEncryptionAvailable()) return false;
  // On Linux without a keyring Electron falls back to a fixed, publicly known
  // password ("basic_text"), which is obfuscation rather than encryption.
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
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
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch (error) {
    // The OS key changed (keychain reset, profile copied to another machine or
    // user). The value can never be recovered, so drop it: callers then ask the
    // user to enter the key or sign in again instead of failing every time.
    console.warn(`[secrets] stored ${name.split(":")[0]} could not be decrypted and was removed`, error instanceof Error ? error.message : "unknown error");
    deleteSecret(name);
    return null;
  }
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
