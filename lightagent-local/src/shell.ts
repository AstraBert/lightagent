import { Shell } from "@cle-does-things/lightagent-core";
import { StdFileMode } from "../../lightagent-core/src/shell.ts";

export class LocalShell implements Shell {
  async exec(
    command: string,
    timeout: number,
    options?: {
      args?: string[];
      stdout?: StdFileMode;
      stderr?: StdFileMode;
      stdin?: StdFileMode;
    },
  ): Promise<
    {
      code: number;
      success: boolean;
      timedOut: boolean;
      stderr: string;
      stdout: string;
    }
  > {
    const cmd = new Deno.Command(command, options);
    const child = cmd.spawn();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // process may have already exited
      }
    }, timeout * 1000);

    const { code, stdout, stderr, success } = await child.output();
    clearTimeout(timer);
    return {
      code,
      stderr: new TextDecoder().decode(stderr),
      stdout: new TextDecoder().decode(stdout),
      success,
      timedOut,
    };
  }
}
