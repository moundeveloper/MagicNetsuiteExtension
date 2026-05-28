import { getExtensionUserId } from "./extensionUser";

export type FeatureRequestStatus =
  | "new"
  | "reviewing"
  | "planned"
  | "in_progress"
  | "released"
  | "declined"
  | "closed";

export type FeatureRequestPriority = "low" | "normal" | "high";

export interface FeatureRequestRecord {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  priority: FeatureRequestPriority;
  status: FeatureRequestStatus;
  admin_response: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureRequestDraft {
  title: string;
  description: string;
  category: string;
  priority: FeatureRequestPriority;
}

export interface FeatureFeedbackConfigState {
  configured: boolean;
  missing: string[];
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const TABLE_NAME = "feature_requests";

export const getFeatureFeedbackConfigState = (): FeatureFeedbackConfigState => {
  const missing = [];
  if (!SUPABASE_URL) missing.push("VITE_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("VITE_SUPABASE_ANON_KEY");
  return { configured: missing.length === 0, missing };
};

const requireConfig = () => {
  const state = getFeatureFeedbackConfigState();
  if (!state.configured) {
    throw new Error(`Missing Supabase configuration: ${state.missing.join(", ")}`);
  }

  return {
    url: SUPABASE_URL!.replace(/\/+$/, ""),
    anonKey: SUPABASE_ANON_KEY!,
  };
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const { url, anonKey } = requireConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || `Supabase request failed (${res.status})`;
    try {
      const parsed = JSON.parse(text) as { code?: string; message?: string };
      if (parsed.code === "PGRST205") {
        message =
          "Supabase cannot find public.feature_requests. Run docs/supabase_feature_feedback.sql in the same Supabase project, then reload the extension.";
      } else if (parsed.message) {
        message = parsed.message;
      }
    } catch {
      // Keep the raw response text when Supabase returns non-JSON.
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
};

const requestColumns =
  "id,user_id,title,description,category,priority,status,admin_response,closed_at,created_at,updated_at";

const requireFirstRow = (rows: FeatureRequestRecord[]): FeatureRequestRecord => {
  const first = rows[0];
  if (!first) throw new Error("Supabase returned no feature request row.");
  return first;
};

export const listFeatureRequests = async (isAdmin: boolean): Promise<FeatureRequestRecord[]> => {
  const userId = await getExtensionUserId();
  const filter = isAdmin ? "" : `&user_id=eq.${encodeURIComponent(userId)}`;
  return request<FeatureRequestRecord[]>(
    `${TABLE_NAME}?select=${requestColumns}${filter}&order=updated_at.desc`
  );
};

export const createFeatureRequest = async (
  draft: FeatureRequestDraft
): Promise<FeatureRequestRecord> => {
  const userId = await getExtensionUserId();
  const rows = await request<FeatureRequestRecord[]>(TABLE_NAME, {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      title: draft.title.trim(),
      description: draft.description.trim(),
      category: draft.category,
      priority: draft.priority,
      status: "new",
    }),
  });
  return requireFirstRow(rows);
};

export const updateFeatureRequest = async (
  id: string,
  patch: Partial<Pick<FeatureRequestRecord, "status" | "admin_response" | "closed_at">>
): Promise<FeatureRequestRecord> => {
  const rows = await request<FeatureRequestRecord[]>(
    `${TABLE_NAME}?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    }
  );
  return requireFirstRow(rows);
};

export const closeFeatureRequest = async (id: string): Promise<FeatureRequestRecord> => {
  return updateFeatureRequest(id, {
    status: "closed",
    closed_at: new Date().toISOString(),
  });
};

export const reopenFeatureRequest = async (
  id: string,
  status: FeatureRequestStatus = "reviewing"
): Promise<FeatureRequestRecord> => {
  return updateFeatureRequest(id, {
    status,
    closed_at: null,
  });
};
