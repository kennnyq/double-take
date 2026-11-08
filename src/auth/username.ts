/**
 * Username + password accounts. Supabase Auth needs an email per user, so a
 * username maps to a synthetic, undeliverable address (`.invalid` is reserved
 * by RFC 2606) that the user never sees. "Confirm email" is off, so nothing is
 * ever sent. The username is also the `@handle` (supabase/migrations).
 * Pure, for `node --test`.
 */
export const USERNAME_DOMAIN = 'users.double-take.invalid';
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const PASSWORD_MIN = 8;

/** What people type: trimmed, without a leading @, lower case. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Why a username can't be used, or null if it can. Letters, digits, `_` and
 * single dots, 3–24 long, no dot first or last (the same rule as the database).
 */
export function usernameProblem(username: string): string | null {
  if (username.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`;
  if (username.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`;
  if (!/^[a-z0-9._]+$/.test(username)) return 'Use only letters, numbers, _ and dots.';
  if (username.startsWith('.') || username.endsWith('.')) return "Can't start or end with a dot.";
  if (username.includes('..')) return "Can't have two dots in a row.";
  return null;
}

/** The sign-in address for a username (call with a valid, normalized username). */
export const usernameEmail = (username: string) => `${username}@${USERNAME_DOMAIN}`;

/** The username behind a sign-in address, or null for other addresses. */
export function usernameFromEmail(email: string | null | undefined): string | null {
  const m = /^([^@]+)@(.+)$/.exec(email ?? '');
  return m && m[2] === USERNAME_DOMAIN ? m[1] : null;
}

/** Why a new password is too weak, or null (the project enforces the same). */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `At least ${PASSWORD_MIN} characters.`;
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'Use both letters and numbers.';
  return null;
}

/** A friendly message for a Supabase Auth error. */
export function authErrorMessage(e: { message?: string; code?: string; status?: number }, mode: 'signIn' | 'signUp'): string {
  const code = e.code ?? '';
  const msg = e.message ?? '';
  if (e.status === 429 || code === 'over_request_rate_limit') return 'Too many attempts. Wait a minute and try again.';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'Wrong username or password.';
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(msg)) return 'That username is taken.';
  if (code === 'weak_password') return 'That password is too weak: use 8+ characters with letters and numbers.';
  // The database refuses a handle that was taken a moment ago.
  if (mode === 'signUp' && /database error/i.test(msg)) return 'That username is taken.';
  return msg || 'Something went wrong. Try again.';
}
