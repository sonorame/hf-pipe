import { join } from "node:path";

export type HopPathEnv = {
  HF_SECRETS_DIR?: string;
  MATRIX_SESSION_FILE?: string;
};

export function hopSecretsDir(home: string, env: HopPathEnv = {}): string {
  if (env.HF_SECRETS_DIR) return env.HF_SECRETS_DIR;
  return join(home, ".hf-pipe", "secrets");
}

export function hopSessionFile(home: string, env: HopPathEnv = {}): string {
  if (env.MATRIX_SESSION_FILE) return env.MATRIX_SESSION_FILE;
  return join(hopSecretsDir(home, env), "matrix-session.json");
}
