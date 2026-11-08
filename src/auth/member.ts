/**
 * Who counts as a member: a signed-in, non-anonymous user. Pure, so it runs
 * under `node --test`. Guests are simply signed out; anonymous sign-ins are off
 * in the project, and this check (like `is_member()` in SQL) is defence in depth.
 */
export interface SessionLike {
  user?: { id?: string | null; is_anonymous?: boolean | null } | null;
}

export function isMember(session: SessionLike | null | undefined): boolean {
  const user = session?.user;
  return !!user?.id && user.is_anonymous !== true;
}

/** Test accounts minted by the dev Worker routes (see worker/src/devAuth.ts). */
export function isTestEmail(email: string | null | undefined): boolean {
  return /^dt-test\+[a-z0-9-]{1,32}@example\.com$/.test(email ?? '');
}
