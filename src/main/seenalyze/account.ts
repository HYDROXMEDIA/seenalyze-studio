// SEENALYZE account sign-in (PKCE through the web dashboard) and calls to the
// dashboard's Studio API. Tokens live only in secure storage in this process.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { shell } from "electron";
import type { DesignRequest, OverlayDefinition, SeenalyzeAccount } from "../../shared/overlays";
import { studioConfig } from "../config";
import { deleteSecret, getSecret, setSecret } from "../secrets";

export const STUDIO_SCHEME = "seenalyze-studio";
const CLIENT_ID = "studio-native";
const REDIRECT_URI = `${STUDIO_SCHEME}://oauth/callback`;
const SESSION_SECRET = "seenalyze:session";
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const DESIGN_TIMEOUT_MS = 130_000;
const REFRESH_MARGIN_MS = 60_000;

interface Session {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

interface PendingSignIn {
  state: string;
  verifier: string;
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export function seenalyzeOrigin(): string {
  const origin = studioConfig().seenalyzeOrigin ?? "https://seenalyzeai.com";
  const url = new URL(origin);
  // Plain HTTP is only acceptable for a local development dashboard.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("seenalyze-origin-invalid");
  }
  return url.origin;
}

export class SeenalyzeAccountService {
  private pending: PendingSignIn | null = null;
  private refreshing: Promise<Session> | null = null;
  private profile: SeenalyzeAccount | null = null;

  get signedIn(): boolean {
    return this.session() !== null;
  }

  cachedProfile(): SeenalyzeAccount | null {
    return this.signedIn ? this.profile : null;
  }

  /** Opens the dashboard consent page and waits for the app link callback. */
  async signIn(): Promise<SeenalyzeAccount> {
    this.pending?.reject(new Error("sign-in-cancelled"));
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const state = base64Url(randomBytes(16));
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error("sign-in-expired"));
      }, SIGN_IN_TIMEOUT_MS);
      this.pending = { state, verifier, resolve, reject, timer };
      // The API route checks the request, signs the user in if needed and opens
      // the consent page with its one-time consent token; the page alone cannot.
      const url = new URL(`${seenalyzeOrigin()}/api/oauth/authorize`);
      url.search = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      }).toString();
      shell.openExternal(url.toString()).catch((error: unknown) => {
        clearTimeout(timer);
        this.pending = null;
        reject(error instanceof Error ? error : new Error("sign-in-cancelled"));
      });
    });
    const tokens = await this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
    this.store(tokens);
    try {
      return await this.refreshProfile();
    } catch (error) {
      // A profile failure right after sign-in is a sign-in failure, not a designer one.
      if (error instanceof Error && error.message === "seenalyze-signed-out") throw error;
      throw new Error("seenalyze-sign-in-failed", { cause: error });
    }
  }

  /** Handles `seenalyze-studio://oauth/callback?code=…&state=…`. Returns true if it was ours. */
  handleCallback(link: string): boolean {
    let url: URL;
    try {
      url = new URL(link);
    } catch (error) {
      console.warn("[seenalyze] ignored malformed app link", error);
      return false;
    }
    if (url.protocol !== `${STUDIO_SCHEME}:` || url.host !== "oauth" || url.pathname !== "/callback") return false;
    const pending = this.pending;
    if (!pending) return true;
    this.pending = null;
    clearTimeout(pending.timer);
    const code = url.searchParams.get("code");
    if (url.searchParams.get("state") !== pending.state || !code) pending.reject(new Error("sign-in-cancelled"));
    else pending.resolve(code);
    return true;
  }

  async signOut(): Promise<void> {
    const session = this.session();
    deleteSecret(SESSION_SECRET);
    this.profile = null;
    if (!session) return;
    await fetch(`${seenalyzeOrigin()}/api/studio/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    }).catch((error: unknown) => console.warn("[seenalyze] sign-out request failed", error instanceof Error ? error.message : error));
  }

  async refreshProfile(): Promise<SeenalyzeAccount> {
    const response = await this.authorizedFetch("/api/studio/auth/me", { method: "GET" }, 15_000);
    const body = (await response.json()) as {
      user?: { email?: string | null; displayName?: string | null; avatarUrl?: string | null; language?: string | null };
      canUseDesigner?: boolean;
    };
    this.profile = {
      email: body.user?.email ?? null,
      displayName: body.user?.displayName ?? null,
      avatarUrl: body.user?.avatarUrl ?? null,
      canUseDesigner: body.canUseDesigner === true,
      language: body.user?.language ?? null,
    };
    return this.profile;
  }

  /** Saves the account's interface language. The dashboard validates the value. */
  async saveLanguage(language: string): Promise<void> {
    await this.authorizedFetch(
      "/api/studio/auth/language",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language }) },
      15_000,
    );
    if (this.profile) this.profile = { ...this.profile, language };
  }

  /** Asks the dashboard to design (or redesign) an overlay; charges the account's credits. */
  async design(
    request: DesignRequest,
    current?: Pick<OverlayDefinition, "html" | "fields">,
  ): Promise<{ design: unknown; creditsCharged: number | null }> {
    const kind = request.kind === "scene" ? "custom" : request.kind;
    const response = await this.authorizedFetch(
      "/api/studio/overlays/generate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify({ prompt: request.prompt, kind, current: current ? { html: current.html, fields: current.fields } : undefined }),
      },
      DESIGN_TIMEOUT_MS,
    );
    const body = (await response.json()) as { overlay?: unknown; creditsCharged?: unknown };
    return { design: body.overlay, creditsCharged: typeof body.creditsCharged === "number" ? body.creditsCharged : null };
  }

  // ----- internals ----------------------------------------------------------

  private async authorizedFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const session = await this.validSession();
    const response = await fetch(`${seenalyzeOrigin()}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${session.accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (response.ok) return response;
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(dashboardErrorCode(response.status, typeof body.error === "string" ? body.error : ""));
  }

  private session(): Session | null {
    const raw = getSecret(SESSION_SECRET);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Session;
    } catch (error) {
      console.warn("[seenalyze] stored session unreadable; signing out", error);
      deleteSecret(SESSION_SECRET);
      return null;
    }
  }

  private async validSession(): Promise<Session> {
    const session = this.session();
    if (!session) throw new Error("seenalyze-signed-out");
    if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return session;
    if (!session.refreshToken) throw new Error("seenalyze-signed-out");
    this.refreshing ??= this.tokenRequest({ grant_type: "refresh_token", refresh_token: session.refreshToken })
      .then((tokens) => this.store(tokens, session))
      .catch((error: unknown) => {
        deleteSecret(SESSION_SECRET);
        console.warn("[seenalyze] session refresh failed", error instanceof Error ? error.message : error);
        throw new Error("seenalyze-signed-out");
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  private async tokenRequest(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
    const response = await fetch(`${seenalyzeOrigin()}/api/studio/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!response.ok || !body.access_token) throw new Error("seenalyze-sign-in-failed");
    return { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in };
  }

  private store(tokens: { access_token: string; refresh_token?: string; expires_in?: number }, previous?: Session): Session {
    const session: Session = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? previous?.refreshToken,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };
    setSecret(SESSION_SECRET, JSON.stringify(session));
    return session;
  }
}

/** Maps dashboard API failures to the app's error codes. */
export function dashboardErrorCode(status: number, error: string): string {
  if (status === 401) return "seenalyze-signed-out";
  if (status === 402) return "insufficient-credits";
  if (status === 403) return "designer-not-allowed";
  if (status === 409) return "design-duplicate";
  if (status === 429) return "design-rate-limited";
  if (status === 502 || error === "studio.errors.invalidDesign") return "design-invalid";
  if (error === "studio.errors.refundPending") return "design-refund-pending";
  return "design-unavailable";
}
