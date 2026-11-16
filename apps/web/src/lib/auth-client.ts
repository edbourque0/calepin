import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ baseURL: window.location.origin });

/** The server registers the OIDC provider (genericOAuth) as a social provider with this id. */
export const OIDC_PROVIDER_ID = "oidc";
