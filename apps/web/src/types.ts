// Types for the access-path fixture produced by pipeline/build-app-fixture.js.
//
// First Session organizes results around *contact paths*, not individual
// therapists: how a parent can actually reach a group of therapists, how easy
// that route looks, and what to ask first.

export type ContactMethod =
  | "email"
  | "form"
  | "phone"
  | "website"
  | "psychology_today";

export type PathType =
  | "shared_intake"
  | "email"
  | "contact_form"
  | "phone"
  | "website"
  | "psychology_today";

export type SessionFormat = "online" | "in_person" | "both" | "unknown";

export type Confidence = "high" | "medium" | "low";

export interface PathTherapist {
  name: string;
  credentials: string;
  location: string;
  session_format: SessionFormat;
  profile_url: string | null;
  email: string | null;
  phone: string | null;
  focus_areas: string[];
}

export interface ContactChannels {
  email: string | null;
  contact_form_url: string | null;
  website: string | null;
  phone: string | null;
  psychology_today_url: string | null;
}

export interface AccessPath {
  path_id: string;
  path_type: PathType;
  organization_or_practice: string;
  /** Readable practice name for display (domain reformatted, never invented). */
  organization_display_name: string;
  area: string;
  primary_contact: string;
  contact_method: ContactMethod;
  contact_channels: ContactChannels;
  contact_source_url: string | null;
  confidence: Confidence;
  /** Human label: "Email found", "Contact form", "Phone only", "PT only", "Manual follow-up". */
  status_label: string;
  is_shared_intake: boolean;
  therapist_count: number;
  session_format: SessionFormat;
  top_focus_areas: string[];
  listed_medicaid: boolean;
  listed_teens: boolean;
  /** Always "not_verified" until real verification data exists. */
  verification_status: "not_verified" | "verified";
  last_checked: string;
  suggested_first_question: string;
  suggested_script: string;
  therapists: PathTherapist[];
}

export interface Fixture {
  generated_at: string;
  source: Record<string, string | null>;
  notes: string;
  totals: {
    therapists: number;
    access_paths: number;
    shared_intake_paths: number;
    public_email_contacts: number;
    therapists_without_website: number;
  };
  /** One global outreach script, surfaced once instead of per-card. */
  outreach: {
    short_question: string;
    long_message: string;
  };
  filters: {
    focus_areas: string[];
    contact_methods: ContactMethod[];
    session_formats: SessionFormat[];
  };
  access_paths: AccessPath[];
}

/** The parent's current filter selections. */
export interface Filters {
  focusAreas: Set<string>;
  /** Contact methods to keep (email / form / phone / psychology_today). */
  methods: Set<ContactMethod>;
  /** Session formats to keep (online / in_person / both). */
  formats: Set<SessionFormat>;
}
