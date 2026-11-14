/** The signed-in user. Shared by the API routes and the client page. */
export type User = {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
};

/** Profile links a Luma user listed. Each is a full URL, or absent. */
export type Socials = {
  luma?: string;
  linkedin?: string;
  twitter?: string;
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  website?: string;
};

export type Participant = {
  id: string;
  name: string;
  role: "host" | "guest";
  avatarUrl: string | null;
  bio: string | null;
  socials: Socials;
};

/** What `POST /api/luma/participants` returns. */
export type EventParticipants = {
  event: { name: string; url: string; startAt: string | null };
  /** Total registered guests. Only a few are public; see `participants`. */
  guestCount: number | null;
  /** Hosts plus the guests Luma features publicly — not the full guest list. */
  participants: Participant[];
};
