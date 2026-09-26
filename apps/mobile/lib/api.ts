import axios from "axios";
import { useAuthStore } from "../store/auth-store";

const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
export const API_BASE_URL = (envUrl && envUrl.trim().length > 0)
  ? envUrl.replace(/\/+$/, "")
  : "https://speak2split.onrender.com";

export const api = axios.create({ baseURL: API_BASE_URL, timeout: 30000 });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

// ---------- Types mirroring the backend contracts ----------

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  authProviders?: string[];
}

export interface Group {
  id: string;
  name: string;
  type: string;
  currency: string;
  inviteCode: string;
  createdAt: string;
}

export interface GroupMember {
  id: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
}

export interface GroupDetail extends Group {
  members: GroupMember[];
}

export interface ExpensePayerInput {
  userId: string;
  amountPaid: number;
}
export interface ExpenseParticipantInput {
  userId: string;
  exactAmount?: number;
  percentage?: number;
  shareUnits?: number;
}

export interface CreateExpenseInput {
  groupId: string;
  title: string;
  amount: number;
  currency?: string;
  category?: string;
  splitMethod: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
  payers: ExpensePayerInput[];
  participants: ExpenseParticipantInput[];
  notes?: string;
  source?: "MANUAL" | "VOICE" | "RECEIPT_OCR" | "RECURRING" | "TEMPLATE";
  aiRawInput?: string;
  aiConfidence?: number;
}

export interface Balance {
  userId: string;
  displayName: string;
  totalPaid: number;
  totalOwed: number;
  netBalance: number;
}

export interface SuggestedSettlement {
  fromUserId: string;
  toUserId: string;
  amount: number;
  fromDisplayName: string;
  toDisplayName: string;
}

export type NameResolutionResult =
  | { status: "RESOLVED"; userId: string; displayName: string; confidence: number }
  | {
      status: "AMBIGUOUS";
      promptMessage: string;
      candidates: { contactId: string; userId?: string; displayName: string; score: number }[];
    }
  | { status: "NOT_FOUND" };

// ---------- API functions ----------

export const authApi = {
  getConfig: () => api.get<{ googleWebClientId: string }>("/auth/config").then((r) => r.data),
  register: (input: { email: string; password: string; displayName: string }) =>
    api.post<{ token: string; user: User }>("/auth/register", input).then((r) => r.data),
  login: (input: { email: string; password: string }) =>
    api.post<{ token: string; user: User }>("/auth/login", input).then((r) => r.data),
  me: () => api.get<User>("/auth/me").then((r) => r.data),
  google: (idToken: string) => api.post<{ token: string; user: User }>("/auth/google", { idToken }).then((r) => r.data),
  apple: (identityToken: string, fullName?: string) =>
    api.post<{ token: string; user: User }>("/auth/apple", { identityToken, fullName }).then((r) => r.data),
};


export const groupsApi = {
  list: () => api.get<Group[]>("/groups").then((r) => r.data),
  create: (input: { name: string; type?: string; currency?: string }) =>
    api.post<Group>("/groups", input).then((r) => r.data),
  detail: (groupId: string) => api.get<GroupDetail>(`/groups/${groupId}`).then((r) => r.data),
  addMember: (groupId: string, email: string) =>
    api.post(`/groups/${groupId}/members`, { email }).then((r) => r.data),
};

export const expensesApi = {
  create: (input: CreateExpenseInput) => api.post("/expenses", input).then((r) => r.data),
  listForGroup: (groupId: string) => api.get(`/expenses/group/${groupId}`).then((r) => r.data),
};

export const exportsApi = {
  groupPdfUrl: (groupId: string) => `${API_BASE_URL}/exports/group/${groupId}/pdf`,
};

export interface Notification {
  id: string;
  groupId: string | null;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  type: string;
  channel: string;
  enabled: boolean;
}

export const notificationsApi = {
  list: () => api.get<Notification[]>("/notifications").then((r) => r.data),
  markRead: (id: string) => api.post(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.post("/notifications/read-all").then((r) => r.data),
  getPreferences: () => api.get<NotificationPreference[]>("/notifications/preferences").then((r) => r.data),
  setPreference: (input: { type: string; channel: string; enabled: boolean }) =>
    api.put("/notifications/preferences", input).then((r) => r.data),
};

export const documentsApi = {
  list: (groupId: string) => api.get(`/documents/group/${groupId}`).then((r) => r.data),
  downloadUrl: (documentId: string) => `${API_BASE_URL}/documents/${documentId}/download`,
  delete: (documentId: string) => api.delete(`/documents/${documentId}`).then((r) => r.data),
};

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: string | null;
  estimatedPrice: number | null;
  isCompleted: boolean;
  assignedToId: string | null;
  assignedToName: string | null;
  addedByName: string;
}
export interface ShoppingList {
  id: string;
  name: string;
  items: ShoppingItem[];
}

export const shoppingApi = {
  getForGroup: (groupId: string) => api.get<ShoppingList[]>(`/shopping/group/${groupId}`).then((r) => r.data),
  addItem: (input: { listId: string; name: string; quantity?: string; estimatedPrice?: number; assignedToId?: string }) =>
    api.post("/shopping/items", input).then((r) => r.data),
  updateItem: (id: string, input: Partial<{ name: string; isCompleted: boolean; assignedToId: string | null }>) =>
    api.patch(`/shopping/items/${id}`, input).then((r) => r.data),
  deleteItem: (id: string) => api.delete(`/shopping/items/${id}`).then((r) => r.data),
};

export interface ExpenseTemplate {
  id: string;
  name: string;
  title: string;
  defaultAmount: number | null;
  category: string;
  splitMethod: string;
  groupId: string | null;
}

export const templatesApi = {
  list: (groupId?: string) => api.get<ExpenseTemplate[]>("/templates", { params: groupId ? { groupId } : {} }).then((r) => r.data),
  create: (input: { groupId?: string; name: string; title: string; defaultAmount?: number; category?: string; splitMethod?: string }) =>
    api.post("/templates", input).then((r) => r.data),
  delete: (id: string) => api.delete(`/templates/${id}`).then((r) => r.data),
  resolve: (id: string, groupId: string) =>
    api
      .get<{
        title: string;
        amount: string | null;
        category: string;
        splitMethod: string;
        suggestedParticipants: { userId: string; displayName: string }[];
      }>(`/templates/${id}/resolve`, { params: { groupId } })
      .then((r) => r.data),
};

export interface SearchResults {
  groups: { id: string; name: string; type: string }[];
  expenses: { id: string; title: string; amount: string; category: string; expense_date: string; group_id: string; group_name: string }[];
  people: { id: string; display_name: string; phone: string | null; email: string | null }[];
  settlements: { id: string; amount: string; method: string; status: string; from_name: string; to_name: string; group_id: string }[];
  recurringExpenses: { id: string; title: string; amount: string; frequency: string; group_id: string }[];
}

export const searchApi = {
  search: (params: { q: string; groupId?: string; minAmount?: number; maxAmount?: number; category?: string }) =>
    api.get<SearchResults>("/search", { params }).then((r) => r.data),
};

export const settlementsApi = {
  balances: (groupId: string) =>
    api
      .get<{ balances: Balance[]; suggestedSettlements: SuggestedSettlement[] }>(
        `/settlements/group/${groupId}/balances`
      )
      .then((r) => r.data),
  create: (input: { groupId: string; toUserId: string; amount: number; method?: string; note?: string }) =>
    api.post("/settlements", input).then((r) => r.data),
  complete: (settlementId: string) => api.post(`/settlements/${settlementId}/complete`).then((r) => r.data),
};

export const resolutionApi = {
  resolveNames: (groupId: string, mentions: string[]) =>
    api
      .post<Record<string, NameResolutionResult>>("/resolve-names", { groupId, mentions })
      .then((r) => r.data),
};

export interface Contact {
  id: string;
  targetUserId: string | null;
  displayName: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  frequencyScore: number;
  lastUsedAt: string | null;
}

export const contactsApi = {
  list: () => api.get<Contact[]>("/contacts").then((r) => r.data),
  addPerson: (input: { displayName: string; phone?: string; email?: string }) =>
    api.post<{ contactId: string; linked: string }>("/contacts", input).then((r) => r.data),
  sync: (contacts: { displayName: string; phones: string[]; emails: string[] }[]) =>
    api
      .post<{ summary: { linkedToUser: number; linkedToContact: number; created: number; skipped: number }; totalProcessed: number }>(
        "/contacts/sync",
        { contacts }
      )
      .then((r) => r.data),
};
