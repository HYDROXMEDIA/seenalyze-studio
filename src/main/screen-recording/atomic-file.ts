import { promises as fs, readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export async function writeAtomic(path: string, data: string | Buffer, backup = false, shouldCommit = () => true): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, data, { mode: 0o600 });
    if (backup) {
      try { JSON.parse(await fs.readFile(path, 'utf8')); await fs.copyFile(path, `${path}.backup`); }
      catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (shouldCommit()) renameSync(temporary, path);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
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
    try { return { value: JSON.parse(await fs.readFile(`${path}.backup`, 'utf8')), recovered: true }; }
    catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return { value: null, recovered: false }; }
  }
}

export function readRecoverableJsonSync(path: string): unknown {
  for (const candidate of [path, `${path}.backup`]) {
    try { return JSON.parse(readFileSync(candidate, 'utf8')); } catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return null;
}
