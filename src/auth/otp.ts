/**
 * What the user typed into the code box: the 6-digit code from the email, or
 * the email's whole sign-in link pasted in. Supabase's built-in sender can't
 * use a custom template on the free plan, so until a custom SMTP sender is set
 * up the email holds a link instead of a code; its `token` is a token hash
 * that `verifyOtp` accepts just the same. Pure, for `node --test`.
 */
export type OtpInput =
  | { kind: 'code'; token: string }
  | { kind: 'link'; tokenHash: string; type: 'magiclink' | 'signup' | 'email' };

export const CODE_LENGTH = 6;

export function parseOtpInput(raw: string): OtpInput | null {
  const s = raw.trim();
  const digits = s.replace(/\s+/g, '');
  if (new RegExp(`^\\d{${CODE_LENGTH}}$`).test(digits)) return { kind: 'code', token: digits };
  if (!/^https?:\/\//i.test(s)) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  const tokenHash = url.searchParams.get('token') ?? url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (!tokenHash || !/^[\w-]{8,}$/.test(tokenHash)) return null;
  if (type !== 'magiclink' && type !== 'signup' && type !== 'email') return null;
  return { kind: 'link', tokenHash, type };
}

/** A plausible email address (Supabase does the real check). */
export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
