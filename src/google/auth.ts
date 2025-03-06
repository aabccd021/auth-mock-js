import { assert, object, optional, string } from "superstruct";
import { type Context, errorMessage } from "../util.ts";

const LoginSession = object({
  client_id: optional(string()),
  redirect_uri: string(),
  state: optional(string()),
  scope: optional(string()),
  code_challenge_method: optional(string()),
  code_challenge_value: optional(string()),
  id_token_sub: optional(string()),
});

function formInput(name: string, value: string | null): string {
  if (value === null) {
    return "";
  }
  return `<input type="hidden" name="${name}" value="${value}" />`;
}

function handleGet(req: Request): Response {
  const searchParams = new URL(req.url).searchParams;

  const responseType = searchParams.get("response_type");
  if (responseType !== "code") {
    return errorMessage(
      `Invalid response_type: "${responseType}".`,
      `Expected "code".`,
    );
  }

  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const scope = searchParams.get("scope");
  const state = searchParams.get("state");
  const codeChallengeMethod = searchParams.get("code_challenge_method");
  const codeChallengeValue = searchParams.get("code_challenge");

  const loginForm = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Login with Google</title>
      </head>
      <body>
        <h1>Login with Google</h1>

        <p>Following fields are payload of id_token returned by https://oauth2.googleapis.com/token</p>

        <p>See 
          <a href="https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo">
            Google's OpenID Connect documentation
          </a>
          for more information
        </p>

        <form method="post">

          ${formInput("client_id", clientId)}
          ${formInput("redirect_uri", redirectUri)}
          ${formInput("scope", scope)}
          ${formInput("state", state)}
          ${formInput("code_challenge_method", codeChallengeMethod)}
          ${formInput("code_challenge_value", codeChallengeValue)}

          <label for="id_token_sub">sub</label>
          <input type="text" name="id_token_sub" id="id_token_sub" maxlength="255" required pattern="+" />

          <button>Submit</button>
        </form>

      </body>
    </html>
  `;
  return new Response(loginForm, {
    headers: {
      "content-type": "text/html",
    },
  });
}

async function handlePost(req: Request, ctx: Context): Promise<Response> {
  const formData = await req.formData();
  const loginSession = Object.fromEntries(formData.entries());

  try {
    assert(loginSession, LoginSession);
  } catch (err) {
    console.error(err);
    return errorMessage("Invalid login session.");
  }

  const code = crypto.randomUUID();

  try {
    ctx.db
      .query(
        `
    INSERT INTO auth_session (code, client_id, redirect_uri, scope, sub, code_challenge_method, code_challenge_value)
    VALUES ($code, $clientId, $redirectUri, $scope, $sub, $codeChallengeMethod, $codeChallengeValue)
  `,
      )
      .run({
        code,
        clientId: loginSession.client_id ?? null,
        redirectUri: loginSession.redirect_uri ?? null,
        scope: loginSession.scope ?? null,
        sub: loginSession.id_token_sub ?? null,
        codeChallengeMethod: loginSession.code_challenge_method ?? null,
        codeChallengeValue: loginSession.code_challenge_value ?? null,
      });
  } catch (err) {
    console.error(err);
    return errorMessage("Failed to store login session.");
  }

  const forwardedParamNames = ["state", "code", "scope", "authUser", "prompt"];

  const redirectUrl = new URL(loginSession.redirect_uri);
  redirectUrl.searchParams.set("code", code);

  for (const [key, value] of Object.entries(loginSession)) {
    if (typeof value === "string" && forwardedParamNames.includes(key)) {
      redirectUrl.searchParams.set(key, value);
    }
  }

  return new Response(null, {
    status: 303,
    headers: { Location: redirectUrl.toString() },
  });
}

export async function handle(req: Request, ctx: Context): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (path !== "/o/oauth2/v2/auth") {
    return new Response(null, { status: 404 });
  }

  if (req.method === "GET") {
    return handleGet(req);
  }

  if (req.method === "POST") {
    return await handlePost(req, ctx);
  }

  return new Response("Method Not Allowed", { status: 405 });
}
