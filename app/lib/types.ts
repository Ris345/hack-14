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
 * carried. A section is absent when there's nothing for it: no such link, no
 * confident LinkedIn match, or a page that couldn't be fetched. A no-match is
 * the common case, not an error.
 */
export type Enrichment = {
  linkedin?: {
    url: string;
    /**
     * How much to trust that this profile is *this* person.
     * `high` — the link came from Luma itself, so there's nothing to guess.
     * `medium` — a search hit whose title carries the participant's full name.
     */
    confidence: "high" | "medium";
    /** Their LinkedIn headline, e.g. "Founder @ The Builder Series". */
    headline: string | null;
    location: string | null;
    /** The About section, or the search snippet if the page couldn't be read. */
    about: string | null;
  };
  twitter?: {
    bio: string | null;
    followers: number | null;
  };
  website?: {
    title: string | null;
    summary: string | null;
  };
};

export type EnrichedParticipant = Participant & { enrichment: Enrichment };

/** What `POST /api/luma/participants` returns. */
export type EventParticipants = {
  event: { name: string; url: string; startAt: string | null };
  /** Total registered guests, as Luma reports it. */
  guestCount: number | null;
  /** Hosts, then guests: the featured few (`public`) or everyone (`guest-list`). */
  participants: Participant[];
  /**
   * `public` — hosts and featured guests only, what anyone can see.
   * `guest-list` — the full list Luma shows the user as a registered guest.
   */
  source: "public" | "guest-list";
  /** Why a connected user got the public view instead of the full list. */
  notice: string | null;
};

/** What `GET /api/luma/connect` returns. */
export type LumaConnection =
  | { connected: true; name: string | null }
  | { connected: false };
