// Minimal Node typings for the balance script (avoids adding @types/node to the project).
declare const process: { env: Record<string, string | undefined> };
declare module 'node:fs' {
  export function writeFileSync(path: URL | string, data: string): void;
}
