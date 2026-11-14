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

/**
 * What we learned about a participant from the public web, beyond what Luma
 * carried. Every field is optional: a no-match is the common case, not an error.
 */
export type Profile = {
  linkedin: string | null;
  /** The LinkedIn headline, e.g. "Founder & CEO at Acme". */
  headline: string | null;
  /** A few sentences of public context, from you.com's extracted highlights. */
  summary: string | null;
  /**
   * How much to trust that this profile is *this* person.
   * `high` — the handle came from Luma itself, so there's nothing to guess.
   * `medium` — a search hit whose title carries the participant's full name.
   */
  confidence: "high" | "medium";
};

export type EnrichedParticipant = Participant & {
  /** `null` when no profile could be matched confidently. */
  profile: Profile | null;
};

/** What `POST /api/luma/participants` returns. */
export type EventParticipants = {
  event: { name: string; url: string; startAt: string | null };
  /** Total registered guests. Only a few are public; see `participants`. */
  guestCount: number | null;
  /** Hosts plus the guests Luma features publicly — not the full guest list. */
  participants: Participant[];
};
