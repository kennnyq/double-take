/** Stand-in people you can send a Take to. Avatars are initial-letter gradients. */
export interface Friend {
  handle: string;
  name: string;
  /** Recent-activity badge, e.g. "6m". */
  active?: string;
  online?: boolean;
}

export const FRIENDS: Friend[] = [
  { handle: 'mara.wren', name: 'Mara Wren', online: true },
  { handle: 'theo_park', name: 'Theo Park', active: '6m' },
  { handle: 'juno.reyes', name: 'Juno Reyes' },
  { handle: 'calla.b', name: 'Calla Brooks', active: '12m' },
  { handle: 'ozzie.k', name: 'Oscar Kim', online: true },
  { handle: 'priya.loops', name: 'Priya Natarajan' },
  { handle: 'deshawn.m', name: 'DeShawn Miles', active: '2h' },
  { handle: 'lena.vos', name: 'Lena Vos' },
  { handle: 'rafi_draws', name: 'Rafi Haddad', online: true },
  { handle: 'nell.okafor', name: 'Nell Okafor', active: '40m' },
];

export function filterFriends(query: string, list: Friend[] = FRIENDS): Friend[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((f) => f.name.toLowerCase().includes(q) || f.handle.toLowerCase().includes(q));
}
