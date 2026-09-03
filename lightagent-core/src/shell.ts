export type StdFileMode = "piped" | "inherit" | "null";

export interface Shell {
  exec: (
    command: string,
    timeout: number,
    options?: {
      args?: string[];
      cwd?: string;
      stdout?: StdFileMode;
      stderr?: StdFileMode;
      stdin?: StdFileMode;
    },
  ) => Promise<{
    code: number;
    success: boolean;
    timedOut: boolean;
    stderr: string;
    stdout: string;
  }>;
}
