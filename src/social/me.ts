/** The signed-in user (mock). Change here to change it everywhere. */
export const ME = { handle: 'kennnyq', name: 'Kenny Quach', followers: 51, following: 4 };

export const clipLink = (clipId: string) => `https://doubletake.example/t/${clipId}`;
export const profileLink = (handle: string = ME.handle) => `https://doubletake.example/@${handle}`;
