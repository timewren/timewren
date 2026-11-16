/* Jest-mock for ~/lib/auth/client — better-auth trækker ESM-krypto ind som jest ikke skal transformere. */
export type AuthSession = { user: { id: string; name: string; email: string }; session: { id: string } };

let cookie = '';

export const authClient = {
  getSession: jest.fn(async () => ({ data: null as AuthSession | null, error: null })),
  signOut: jest.fn(async () => ({})),
  signIn: {
    magicLink: jest.fn(async () => ({ error: null })),
    email: jest.fn(async () => ({ error: null })),
    social: jest.fn(async () => ({ error: null })),
    oauth2: jest.fn(async () => ({ error: null })),
  },
};

export function getSessionCookie(): Promise<string> {
  return Promise.resolve(cookie);
}

export function __setCookie(value: string) {
  cookie = value;
}

export async function authHeaders(): Promise<Record<string, string>> {
  return cookie ? { Cookie: cookie } : {};
}
