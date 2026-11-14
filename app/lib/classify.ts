import type { Enrichment, Participant } from "./types";

/**
 * Tag participants by role and by industry/interest, from whatever text we
 * have on them: Luma bio, LinkedIn headline and about, X bio, website.
 *
 * Plain keyword rules, on purpose. They run instantly in the browser as
 * enrichment arrives, cost nothing, and when a tag looks wrong you can see
 * exactly which word caused it. A person can carry several tags.
 *
 * Client-safe: no server-only imports.
 */

export type Tag = { id: string; label: string; pattern: RegExp };

/** `\b` on both ends, case-insensitive. Keeps "ai" from matching "said". */
const words = (...alternatives: string[]) =>
  new RegExp(`\\b(?:${alternatives.join("|")})\\b`, "i");

export const ROLE_TAGS: Tag[] = [
  {
    id: "founder",
    label: "Founder",
    pattern: words("co-?founder", "founder", "founding", "ceo", "owner"),
  },
  {
    id: "leadership",
    label: "Leadership",
    pattern: words(
      "c[tmopfr]o",
      "chief \\w+ officer",
      "vp",
      "vice president",
      "head of",
      "director",
      "general manager",
      "president",
    ),
  },
  {
    id: "engineer",
    label: "Engineer",
    pattern: words(
      "engineer(?:ing)?",
      "developers?",
      "swe",
      "sde",
      "software",
      "programmer",
      "full-?stack",
      "back-?end",
      "front-?end",
      "devops",
      "sre",
      "architect",
      "hacker",
    ),
  },
  {
    id: "research",
    label: "Research / Data",
    pattern: words(
      "research(?:er)?",
      "scientist",
      "data scien\\w*",
      "data analyst",
      "phd",
      "ml engineer",
      "machine learning engineer",
    ),
  },
  {
    id: "product",
    label: "Product",
    pattern: words("product(?: manager| management| lead| owner)?", "pm", "tpm"),
  },
  {
    id: "design",
    label: "Design",
    pattern: words("designer", "design", "ux", "ui/ux", "creative director"),
  },
  {
    id: "investor",
    label: "Investor",
    pattern: words(
      "investor",
      "investing",
      "venture",
      "vc",
      "angel",
      "general partner",
      "managing partner",
      "\\w+ capital",
      "\\w+ ventures",
      "fund",
    ),
  },
  {
    id: "sales",
    label: "Sales / Growth",
    pattern: words(
      "sales",
      "business development",
      "bd",
      "account executive",
      "partnerships?",
      "revenue",
      "gtm",
      "go-to-market",
      "growth",
    ),
  },
  {
    id: "marketing",
    label: "Marketing",
    pattern: words("marketing", "marketer", "brand", "cmo", "comms", "communications", "pr"),
  },
  {
    id: "community",
    label: "Community / Events",
    pattern: words(
      "community",
      "communities",
      "events?",
      "organi[sz]er",
      "ecosystem",
      "devrel",
      "developer relations",
      "evangelist",
      "advocate",
      "meetups?",
    ),
  },
  {
    id: "advisor",
    label: "Advisor / Consultant",
    pattern: words("advisor", "adviser", "consultant", "consulting", "fractional", "freelance"),
  },
  {
    id: "student",
    label: "Student",
    pattern: words("student", "undergrad", "intern", "phd candidate", "mba candidate", "class of \\d{4}"),
  },
];

export const TOPIC_TAGS: Tag[] = [
  {
    id: "ai",
    label: "AI",
    pattern: words(
      "ai",
      "a\\.i\\.",
      "artificial intelligence",
      "machine learning",
      "ml",
      "llms?",
      "genai",
      "generative",
      "agents?",
      "agentic",
      "nlp",
      "computer vision",
      "deep learning",
    ),
  },
  {
    id: "fintech",
    label: "Fintech",
    pattern: words(
      "fintech",
      "payments?",
      "banking",
      "finance",
      "financial",
      "trading",
      "insurtech",
      "lending",
      "accounting",
    ),
  },
  {
    id: "web3",
    label: "Crypto / Web3",
    pattern: words(
      "crypto",
      "web3",
      "blockchain",
      "defi",
      "ethereum",
      "bitcoin",
      "solana",
      "nfts?",
      "on-?chain",
    ),
  },
  {
    id: "health",
    label: "Health / Bio",
    pattern: words(
      "health",
      "healthcare",
      "medical",
      "medicine",
      "biotech",
      "pharma",
      "clinical",
      "wellness",
      "fitness",
    ),
  },
  {
    id: "climate",
    label: "Climate / Energy",
    pattern: words("climate", "energy", "sustainab\\w*", "clean ?tech", "carbon", "solar"),
  },
  {
    id: "devtools",
    label: "Dev tools / Infra",
    pattern: words(
      "developer tools",
      "devtools",
      "infrastructure",
      "infra",
      "cloud",
      "open[- ]source",
      "apis?",
      "databases?",
      "kubernetes",
      "security",
      "cyber\\w*",
    ),
  },
  {
    id: "saas",
    label: "B2B / SaaS",
    pattern: words("saas", "b2b", "enterprise", "workflow", "automation", "productivity"),
  },
  {
    id: "consumer",
    label: "Consumer",
    pattern: words(
      "consumer",
      "e-?commerce",
      "retail",
      "marketplaces?",
      "gaming",
      "games",
      "fashion",
      "food",
      "travel",
    ),
  },
  {
    id: "media",
    label: "Media / Creator",
    pattern: words(
      "media",
      "creators?",
      "content",
      "podcasts?",
      "journalis\\w*",
      "newsletter",
      "writer",
      "writing",
      "youtube",
      "film",
      "storytelling",
    ),
  },
  {
    id: "education",
    label: "Education",
    pattern: words("education", "edtech", "teaching", "teacher", "learning platform", "bootcamp"),
  },
  {
    id: "hardware",
    label: "Robotics / Hardware",
    pattern: words("robots?", "robotics", "hardware", "iot", "drones?", "semiconductors?", "chips?"),
  },
  {
    id: "realestate",
    label: "Real estate",
    pattern: words("real estate", "proptech", "property", "properties"),
  },
  {
    id: "legal",
    label: "Legal",
    pattern: words("legal", "law", "attorney", "lawyer", "compliance", "legaltech"),
  },
];

/** Everything we know about a person, as one lowercase-insensitive blob. */
export function profileText(p: Participant, e: Enrichment | undefined): string {
  return [
    p.name,
    p.bio,
    e?.linkedin?.headline,
    e?.linkedin?.about,
    e?.linkedin?.location,
    e?.twitter?.bio,
    e?.website?.title,
    e?.website?.summary,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The text that says what someone *does*: bio and headline only. Roles come
 * from here so "I write about founders" in an About section doesn't make
 * someone a founder.
 */
function roleText(p: Participant, e: Enrichment | undefined): string {
  return [p.bio, e?.linkedin?.headline, e?.twitter?.bio].filter(Boolean).join("\n");
}

export type Classified = {
  roles: string[];
  topics: string[];
  /** 0 (student) … 5 (founder / C-level). Used to sort by seniority. */
  seniority: number;
  /** Lowercased, for free-text search. */
  searchText: string;
};

export function classify(p: Participant, e: Enrichment | undefined): Classified {
  const all = profileText(p, e);
  const role = roleText(p, e);
  return {
    roles: ROLE_TAGS.filter((t) => t.pattern.test(role)).map((t) => t.id),
    topics: TOPIC_TAGS.filter((t) => t.pattern.test(all)).map((t) => t.id),
    seniority: seniority(e?.linkedin?.headline ?? role),
    searchText: all.toLowerCase(),
  };
}

const SENIORITY: [number, RegExp][] = [
  [5, words("co-?founder", "founder", "ceo", "c[tmopfr]o", "chief \\w+ officer", "owner", "president")],
  [4, words("vp", "vice president", "head of", "general partner", "managing partner", "partner")],
  [3, words("director", "principal", "general manager")],
  [2, words("lead", "senior", "sr\\.?", "staff", "manager")],
  [0, words("student", "intern", "undergrad")],
];

/** The highest level any rule matches; 1 for someone with a role we can't rank. */
export function seniority(text: string): number {
  if (!text.trim()) return 1;
  for (const [level, pattern] of SENIORITY) {
    if (pattern.test(text)) return level;
  }
  return 1;
}
