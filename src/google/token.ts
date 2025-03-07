import { type Context, errorMessage, getStringFormData } from "../util.ts";

function generateGoogleIdToken(
  clientId: string,
  sub: string,
): string | undefined {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const headerStr = new TextEncoder()
    .encode(JSON.stringify(header))
    .toBase64({ alphabet: "base64url", omitPadding: true });

  const payload = {
    aud: clientId,
    exp: Date.now() + 3600,
    iat: Date.now(),
    iss: "https://accounts.google.com",
    sub,
  };

  const payloadStr = new TextEncoder()
    .encode(JSON.stringify(payload))
    .toBase64({ alphabet: "base64url", omitPadding: true });

  const signature = new Bun.CryptoHasher("sha256")
    .update(`${headerStr}.${payloadStr}`)
    .digest();

  const signatureStr = new Uint8Array(signature).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });

  return `${headerStr}.${payloadStr}.${signatureStr}`;
}

export type AuthSession = {
  clientId: string;
  redirectUri: string;
  scope?: string;
  sub?: string;
  codeChallenge?: string;
  codeChallengeMethod?: "S256" | "plain";
};

function decodeAuthSession(authSession: unknown): AuthSession | null {
  if (authSession === null) {
    return null;
  }
  if (typeof authSession !== "object") {
    throw new Error("Absurd authSession: not an object");
  }

  const clientId =
    "client_id" in authSession && typeof authSession.client_id === "string"
      ? authSession.client_id
      : null;
  if (clientId === null) {
    throw new Error("Absurd clientId: null");
  }

  const redirectUri =
    "redirect_uri" in authSession &&
    typeof authSession.redirect_uri === "string"
      ? authSession.redirect_uri
      : null;
  if (redirectUri === null) {
    throw new Error("Absurd redirectUri: null");
  }

  const scope =
    "scope" in authSession && typeof authSession.scope === "string"
      ? authSession.scope
      : undefined;

  const sub =
    "sub" in authSession && typeof authSession.sub === "string"
      ? authSession.sub
      : undefined;

  const codeChallenge =
    "code_challenge" in authSession &&
    typeof authSession.code_challenge === "string"
      ? authSession.code_challenge
      : undefined;

  const codeChallengeMethod =
    "code_challenge_method" in authSession
      ? authSession.code_challenge_method
      : undefined;

  if (
    codeChallengeMethod !== "S256" &&
    codeChallengeMethod !== "plain" &&
    codeChallengeMethod !== null
  ) {
    throw new Error("Absurd codeChallengeMethodObj: invalid value");
  }

  return {
    clientId,
    redirectUri,
    scope,
    sub,
    codeChallenge,
    codeChallengeMethod: codeChallengeMethod ?? undefined,
  };
}

export async function handle(req: Request, { db }: Context): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  const formData = await getStringFormData(req);

  const grantType = formData.get("grant_type");
  if (grantType === undefined) {
    return errorMessage("Parameter grant_type is required.");
  }
  if (grantType !== "authorization_code") {
    return errorMessage(
      `Invalid grant_type: "${grantType}". Expected "authorization_code".`,
    );
  }

  const code = formData.get("code");
  if (code === undefined) {
    return errorMessage("Parameter code is required.");
  }

  const authSessionRaw = db
    .query("SELECT * FROM google_auth_session WHERE code = $code")
    .get({ code });

  const authSession = decodeAuthSession(authSessionRaw);
  if (authSession === null) {
    return errorMessage(`Auth session not found for code: "${code}".`);
  }

  db.query("DELETE FROM google_auth_session WHERE code = $code").run({ code });

  if (authSession.codeChallenge !== undefined) {
    if (authSession.codeChallengeMethod === "plain") {
      return errorMessage("Code challenge plain is currently not supported.");
    }

    const codeVerifier = formData.get("code_verifier");
    if (codeVerifier === undefined) {
      return errorMessage("Parameter code_verifier is required.");
    }

    const codeChallengeBytes = new TextEncoder().encode(codeVerifier);
    const codeChallengeHash = await crypto.subtle.digest(
      "SHA-256",
      codeChallengeBytes,
    );
    const expectedCodeChallenge = new Uint8Array(codeChallengeHash).toBase64({
      alphabet: "base64url",
      omitPadding: true,
    });

    if (expectedCodeChallenge !== authSession.codeChallenge) {
      return errorMessage(
        "Hash of code_verifier does not match code_challenge.",
      );
    }
  }

  if (formData.get("redirect_uri") !== authSession.redirectUri) {
    return errorMessage("Invalid redirect_uri.");
  }

  const authHeader = req.headers.get("Authorization");
  if (authHeader === null) {
    return errorMessage("Authorization header is required.");
  }

  const [prefix, credentials] = authHeader.split(" ");

  if (prefix !== "Basic") {
    return errorMessage(
      `Invalid Authorization header prefix: "${prefix}". Expected "Basic".`,
    );
  }

  if (credentials === undefined) {
    return errorMessage("Credentials not found in Authorization header.");
  }

  const [clientId, clientSecret] = atob(credentials).split(":");

  if (clientId !== authSession.clientId) {
    return errorMessage("Invalid client_id");
  }

  if (clientSecret !== "mock_client_secret") {
    return errorMessage(
      `Invalid client_secret. Expected "mock_client_secret".`,
      "Never use production client_secret in tests.",
    );
  }

  if (authSession.scope === undefined) {
    return errorMessage("scope is required.");
  }

  if (authSession.sub === undefined) {
    return errorMessage("sub is required.");
  }

  const scopes = authSession.scope.split(" ");
  const idToken = scopes.includes("openid")
    ? generateGoogleIdToken(clientId, authSession.sub)
    : undefined;

  const responseBody: Record<string, string | number | undefined> = {
    id_token: idToken,
    access_token: "mock_access_token",
    scope: authSession.scope ?? undefined,
    token_type: "Bearer",
    expires_in: 3600,
  };

  const cleanResponseBody = Object.fromEntries(
    Object.entries(responseBody).filter(([_, value]) => value !== undefined),
  );

  return new Response(JSON.stringify(cleanResponseBody), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
