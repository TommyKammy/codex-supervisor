export interface WebUiMutationAuthOptions {
  token: string;
}

export const WEBUI_MUTATION_AUTH_HEADER = "x-codex-supervisor-mutation-token";
export const WEBUI_MUTATION_AUTH_ENV_VAR = "CODEX_SUPERVISOR_WEBUI_MUTATION_TOKEN";
export const WEBUI_MUTATION_AUTH_STORAGE_KEY = "codex_supervisor_webui_mutation_token";
