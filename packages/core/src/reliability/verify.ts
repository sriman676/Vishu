import type { Terminal } from "../tools/terminal.js";

export interface ValidationResult {
  ok: boolean;
  output: string;
}

export interface Validator {
  name: string;
  run(): Promise<ValidationResult>;
}

/** A validator that passes iff a shell command exits 0 (tests/linters/typecheck/build). */
export function shellValidator(terminal: Terminal, command: string, name = command): Validator {
  return {
    name,
    run: async () => {
      const { stdout, exitCode } = await terminal.exec(command);
      return { ok: exitCode === 0, output: stdout };
    },
  };
}

/**
 * Self-verification loop: run validator → on failure, hand the output to `fix` → re-run,
 * bounded by maxAttempts. Validate intermediate state, not just the final answer.
 */
export async function selfVerify(
  validator: Validator,
  fix: (failureOutput: string) => Promise<void>,
  maxAttempts = 3,
): Promise<{ ok: boolean; attempts: number; output: string }> {
  let result = await validator.run();
  let attempts = 0;
  while (!result.ok && attempts < maxAttempts) {
    attempts += 1;
    await fix(result.output);
    result = await validator.run();
  }
  return { ok: result.ok, attempts, output: result.output };
}
