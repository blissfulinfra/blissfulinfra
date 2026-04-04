export class DeployTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployTargetError";
  }
}

export class PrereqMissingError extends Error {
  readonly tool: string;
  readonly installHint: string;

  constructor(tool: string, installHint: string) {
    super(`Required CLI tool not found: ${tool}\n${installHint}`);
    this.name = "PrereqMissingError";
    this.tool = tool;
    this.installHint = installHint;
  }
}

export class DeployFailedError extends Error {
  readonly exitCode?: number;
  readonly stderr?: string;

  constructor(message: string, exitCode?: number, stderr?: string) {
    super(message);
    this.name = "DeployFailedError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}
