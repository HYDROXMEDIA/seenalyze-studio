import { promises as fs, readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// App data is private to the user (0o600); files the user saves for other apps pass a normal mode.
export async function writeAtomic(path: string, data: string | Buffer, backup = false, shouldCommit = () => true, mode = 0o600): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, data, { mode });
    if (backup) {
      try { JSON.parse(await fs.readFile(path, 'utf8')); await fs.copyFile(path, `${path}.backup`); }
      catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (shouldCommit()) renameSync(temporary, path);
  } finally {
    // Normally already renamed away; a leftover that cannot be removed is only logged.
    await fs.rm(temporary, { force: true }).catch((error: unknown) => console.warn(`[screen-recording] temporary file could not be removed: ${error instanceof Error ? error.message : String(error)}`));
  }
}

export function writeAtomicSync(path: string, data: string, backup = false): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, data, { mode: 0o600 });
    if (backup && existsSync(path)) {
      try { JSON.parse(readFileSync(path, 'utf8')); copyFileSync(path, `${path}.backup`); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function readRecoverableJson(path: string): Promise<{ value: unknown; recovered: boolean }> {
  try { return { value: JSON.parse(await fs.readFile(path, 'utf8')), recovered: false }; }
  catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (error instanceof SyntaxError) console.warn(`[screen-recording] saved data is unreadable, trying its backup: ${path}`);
    try { return { value: JSON.parse(await fs.readFile(`${path}.backup`, 'utf8')), recovered: true }; }
    catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (error instanceof SyntaxError) console.warn(`[screen-recording] backup of saved data is unreadable too: ${path}`);
      return { value: null, recovered: false };
    }
  }
}

export function readRecoverableJsonSync(path: string): unknown {
  for (const candidate of [path, `${path}.backup`]) {
    try { return JSON.parse(readFileSync(candidate, 'utf8')); } catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return null;
}
