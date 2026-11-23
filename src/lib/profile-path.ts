/** Site path of a member profile (client-safe, no server imports). */
export const profilePath = (ign: string) => `/p/${encodeURIComponent(ign)}`;
