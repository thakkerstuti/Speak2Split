/**
 * Route-level tests: the REAL Express app (createApp), real routers, real
 * middleware, real error handling and real shared split/resolution logic —
 * with the Mongoose models replaced by the in-memory fake in ./fake-db.
 *
 * What this proves: permission checks, membership rules, validation, error
 * handling and the request/response contracts of each route.
 * What it does NOT prove: real MongoDB query semantics, indexes, casting or
 * transactions — those still need a run against a real database.
 */
jest.mock("../db/models/Group", () => {
  const { fakeDb } = require("./fake-db");
  return { GroupModel: fakeDb.model("groups"), GroupMemberModel: fakeDb.model("groupmembers") };
});
jest.mock("../db/models/User", () => ({ UserModel: require("./fake-db").fakeDb.model("users") }));
jest.mock("../db/models/Expense", () => ({ ExpenseModel: require("./fake-db").fakeDb.model("expenses") }));
jest.mock("../db/models/Settlement", () => ({ SettlementModel: require("./fake-db").fakeDb.model("settlements") }));
jest.mock("../db/models/Contact", () => ({ ContactModel: require("./fake-db").fakeDb.model("contacts") }));
jest.mock("../db/models/ActivityEvent", () => ({ ActivityEventModel: require("./fake-db").fakeDb.model("activity") }));
jest.mock("../db/models/RecurringExpense", () => ({ RecurringExpenseModel: require("./fake-db").fakeDb.model("recurring") }));
jest.mock("../db/models/ExpenseTemplate", () => ({ ExpenseTemplateModel: require("./fake-db").fakeDb.model("templates") }));
jest.mock("../db/models/Document", () => ({ DocumentModel: require("./fake-db").fakeDb.model("documents") }));
jest.mock("../db/models/ShoppingList", () => ({ ShoppingListModel: require("./fake-db").fakeDb.model("shopping") }));
jest.mock("../db/models/Notification", () => {
  const { fakeDb } = require("./fake-db");
  return {
    NotificationModel: fakeDb.model("notifications"),
    NotificationPreferenceModel: fakeDb.model("notificationprefs"),
    NotificationDeviceModel: fakeDb.model("devices"),
  };
});
jest.mock("../notifications/notification.service", () => ({
  notify: jest.fn().mockResolvedValue({ notificationId: "n" }),
  notifyGroupMembers: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../realtime/socket", () => ({ broadcastToGroup: jest.fn(), initRealtime: jest.fn() }));
jest.mock("../documents/storage", () => ({ saveFile: jest.fn(), readFile: jest.fn(), deleteFile: jest.fn() }));

import type { Server } from "http";
import express from "express";
import jwt from "jsonwebtoken";
import { createApp } from "../app";
import { JWT_SECRET } from "../config";
import { runRecurringGeneration } from "../recurring/scheduler";
import { fakeDb, Doc } from "./fake-db";
import { saveFile } from "../documents/storage";
import { clearAiEnv } from "../services/ai/__tests__/helpers";
import { resetAiWarnings, resetAssemblyAiCircuitBreaker } from "../services/ai";

// Voice parsing must not call any external LLM in tests — with no keys set,
// the parser uses its offline heuristic.
for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "GROQ_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"]) {
  delete process.env[k];
}

const users = fakeDb.model("users");
const groups = fakeDb.model("groups");
const members = fakeDb.model("groupmembers");
const expenses = fakeDb.model("expenses");
const settlements = fakeDb.model("settlements");
const contacts = fakeDb.model("contacts");
const recurring = fakeDb.model("recurring");

// Same defaults as the real Mongoose schemas.
expenses.defaults = { status: "ACTIVE", currency: "INR", splitMethod: "EQUAL", source: "MANUAL" };
recurring.defaults = { isActive: true };
// Same unique index as ExpenseSchema: one expense per recurring occurrence.
expenses.uniqueIndexes = [{ fields: ["recurringExpenseId", "recurringOccurrenceDate"], partialExists: "recurringExpenseId" }];
settlements.defaults = { status: "PENDING", method: "CASH" };
members.defaults = { role: "MEMBER", status: "ACTIVE" };
users.defaults = { isActive: true, authAccounts: [] };

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => fakeDb.reset());

const DAY = 86_400_000;
const mkUser = (name: string): Doc =>
  users.insert({ email: `${name.toLowerCase()}@test.io`, displayName: name, firstName: name, isActive: true, authAccounts: [] });
const mkGroup = (name: string, people: Doc[], createdAt = new Date()): Doc => {
  const g = groups.insert({ name, type: "CUSTOM", currency: "INR", createdById: people[0]._id, createdAt });
  people.forEach((p, i) => members.insert({ groupId: g._id, userId: p._id, role: i === 0 ? "OWNER" : "MEMBER", status: "ACTIVE" }));
  return g;
};
const tokenFor = (u: Doc) => jwt.sign({ sub: u._id }, JWT_SECRET);
const isMember = (g: Doc, u: Doc) => members.docs.some((m) => m.groupId === g._id && m.userId === u._id && m.status === "ACTIVE");

async function call(method: string, path: string, user?: Doc, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(user ? { authorization: `Bearer ${tokenFor(user)}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

// ---------------------------------------------------------------------------
describe("async error handling (Express 4)", () => {
  it("turns a throwing async route handler into a 500 and keeps the server alive", async () => {
    const membersModel = members as any;
    const spy = jest.spyOn(membersModel, "findOne").mockImplementationOnce(() => {
      throw new Error("simulated database outage");
    });
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const a = mkUser("Arjun");
    const g = mkGroup("Flat", [a]);

    const failed = await call("GET", `/groups/${g._id}`, a);
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ error: "Internal server error" });

    const ok = await call("GET", `/groups/${g._id}`, a); // server still serving
    expect(ok.status).toBe(200);
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it("wraps rejected promises from handlers on any router registered after the patch", async () => {
    require("../http/async-errors");
    const app = express();
    const router = express.Router();
    router.get("/boom", async () => {
      throw new Error("boom");
    });
    app.use(router);
    app.use((_e: any, _q: any, res: any, _n: any) => res.status(500).json({ caught: true }));
    const s = app.listen(0);
    await new Promise((r) => s.once("listening", r));
    const r = await fetch(`http://127.0.0.1:${(s.address() as any).port}/boom`);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ caught: true });
    await new Promise((r2) => s.close(r2));
  });
});

// ---------------------------------------------------------------------------
describe("ObjectId validation", () => {
  it.each([
    ["GET", "/groups/not-an-id"],
    ["GET", "/groups/aaaaaaaaaaaa"], // 12 chars: accepted by mongoose.isValidObjectId, rejected here
    ["GET", "/expenses/group/123"],
    ["GET", "/settlements/group/xyz/balances"],
    ["POST", "/settlements/xyz/complete"],
    ["GET", "/documents/abc/download"],
    ["DELETE", "/documents/abc"],
    ["POST", "/recurring-expenses/zzz/pause"],
    ["GET", "/templates/bad/resolve?groupId=507f1f77bcf86cd799439011"],
    ["GET", "/templates?groupId=bad"],
    ["POST", "/notifications/bad/read"],
    ["PATCH", "/shopping/items/bad"],
    ["GET", "/exports/group/bad/pdf"],
  ])("%s %s -> 400 before touching the database", async (method, path) => {
    const a = mkUser("Arjun");
    const r = await call(method, path, a, method === "PATCH" ? {} : undefined);
    expect(r.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("search", () => {
  it("does not crash on regex metacharacters and matches them literally", async () => {
    const a = mkUser("Arjun");
    const g = mkGroup("Flat", [a]);
    const base = { groupId: g._id, status: "ACTIVE", amount: 100, category: "general", expenseDate: new Date(), payers: [], participants: [] };
    expenses.insert({ ...base, title: "abc snacks" });
    expenses.insert({ ...base, title: "a.c repair" });

    for (const q of ["(", "[", "*", "a(b", "\\"]) {
      const r = await call("GET", `/search?q=${encodeURIComponent(q)}`, a);
      expect(r.status).toBe(200);
    }
    const r = await call("GET", `/search?q=${encodeURIComponent("a.c")}`, a);
    expect(r.body.expenses.map((e: any) => e.title)).toEqual(["a.c repair"]);
  });

  it("rejects absurdly long queries", async () => {
    const a = mkUser("Arjun");
    const r = await call("GET", `/search?q=${"x".repeat(500)}`, a);
    expect(r.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("expense creation never changes group membership", () => {
  const expenseBody = (g: Doc, payerId: string, participantIds: string[]) => ({
    groupId: g._id,
    title: "Dinner",
    amount: 300,
    splitMethod: "EQUAL",
    payers: [{ userId: payerId, amountPaid: 300 }],
    participants: participantIds.map((userId) => ({ userId })),
  });

  it("rejects a non-member participant and does not add them to the group", async () => {
    const a = mkUser("Arjun");
    const b = mkUser("Bela");
    const outsider = mkUser("Omar");
    const g = mkGroup("Flat", [a, b]);
    const before = members.docs.length;

    const r = await call("POST", "/expenses", a, expenseBody(g, a._id, [a._id, outsider._id]));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("NOT_A_MEMBER");
    expect(members.docs.length).toBe(before);
    expect(isMember(g, outsider)).toBe(false);
    expect(expenses.docs).toHaveLength(0);
  });

  it("rejects a non-member payer", async () => {
    const a = mkUser("Arjun");
    const outsider = mkUser("Omar");
    const g = mkGroup("Flat", [a]);
    const r = await call("POST", "/expenses", a, expenseBody(g, outsider._id, [a._id]));
    expect(r.status).toBe(400);
    expect(isMember(g, outsider)).toBe(false);
  });

  it("an outsider cannot add themselves to a group by creating an expense in it", async () => {
    const a = mkUser("Arjun");
    const outsider = mkUser("Omar");
    const g = mkGroup("Flat", [a]);
    const r = await call("POST", "/expenses", outsider, expenseBody(g, outsider._id, [outsider._id, a._id]));
    expect(r.status).toBe(403);
    expect(isMember(g, outsider)).toBe(false);
  });

  it("creates the expense when everyone is an active member", async () => {
    const a = mkUser("Arjun");
    const b = mkUser("Bela");
    const g = mkGroup("Flat", [a, b]);
    const r = await call("POST", "/expenses", a, expenseBody(g, a._id, [a._id, b._id]));
    expect(r.status).toBe(201);
    expect(expenses.docs).toHaveLength(1);
    expect(expenses.docs[0].participants.map((p: any) => p.shareAmount)).toEqual([150, 150]);
  });

  it("treats a member who LEFT as a non-member", async () => {
    const a = mkUser("Arjun");
    const b = mkUser("Bela");
    const g = mkGroup("Flat", [a, b]);
    members.docs.find((m) => m.userId === b._id)!.status = "LEFT";
    const r = await call("POST", "/expenses", a, expenseBody(g, a._id, [a._id, b._id]));
    expect(r.status).toBe(400);
  });
});

describe("explicit add-member by userId", () => {
  it("refuses to add a stranger by id", async () => {
    const a = mkUser("Arjun");
    const stranger = mkUser("Stan");
    const g = mkGroup("Flat", [a]);
    const r = await call("POST", `/groups/${g._id}/members`, a, { userId: stranger._id });
    expect(r.status).toBe(403);
    expect(isMember(g, stranger)).toBe(false);
  });

  it("adds someone from the requester's contacts", async () => {
    const a = mkUser("Arjun");
    const friend = mkUser("Rahul");
    const g = mkGroup("Flat", [a]);
    contacts.insert({ ownerUserId: a._id, targetUserId: friend._id, displayName: "Rahul", firstName: "Rahul" });
    const r = await call("POST", `/groups/${g._id}/members`, a, { userId: friend._id });
    expect(r.status).toBe(201);
    expect(isMember(g, friend)).toBe(true);
  });

  it("adds someone the requester shares another group with", async () => {
    const a = mkUser("Arjun");
    const friend = mkUser("Rahul");
    mkGroup("College", [a, friend]);
    const g = mkGroup("Flat", [a]);
    const r = await call("POST", `/groups/${g._id}/members`, a, { userId: friend._id });
    expect(r.status).toBe(201);
    expect(isMember(g, friend)).toBe(true);
  });

  it("a non-member cannot add anyone to the group", async () => {
    const a = mkUser("Arjun");
    const outsider = mkUser("Omar");
    const g = mkGroup("Flat", [a]);
    const r = await call("POST", `/groups/${g._id}/members`, outsider, { userId: outsider._id });
    expect(r.status).toBe(403);
    expect(isMember(g, outsider)).toBe(false);
  });

  it("adds a contact without an account as a guest member (no login, no email shown)", async () => {
    const a = mkUser("Arjun");
    const g = mkGroup("Goa", [a]);
    const c = contacts.insert({ ownerUserId: a._id, displayName: "Avni", firstName: "Avni", phone: "9343340600" });
    const r = await call("POST", `/groups/${g._id}/members`, a, { contactId: c._id });
    expect(r.status).toBe(201);
    expect(r.body.displayName).toBe("Avni");
    const detail = await call("GET", `/groups/${g._id}`, a);
    const avni = detail.body.members.find((m: any) => m.displayName === "Avni");
    expect(avni).toMatchObject({ isGuest: true, status: "ACTIVE" });
    expect(avni.email).toBeUndefined();
    // the contact now points at the guest, so adding again reuses it
    const again = await call("POST", `/groups/${g._id}/members`, a, { contactId: c._id });
    expect(again.body.id).toBe(avni.id);
  });

  it("adding a contact that uses Speak2Split adds their real account", async () => {
    const a = mkUser("Arjun");
    const friend = mkUser("Rahul");
    const g = mkGroup("Flat", [a]);
    const c = contacts.insert({ ownerUserId: a._id, targetUserId: friend._id, displayName: "Rahul", firstName: "Rahul" });
    const r = await call("POST", `/groups/${g._id}/members`, a, { contactId: c._id });
    expect(r.status).toBe(201);
    expect(isMember(g, friend)).toBe(true);
  });

  it("cannot add someone else's contact", async () => {
    const a = mkUser("Arjun");
    const b = mkUser("Bela");
    const g = mkGroup("Flat", [a]);
    const bContact = contacts.insert({ ownerUserId: b._id, displayName: "Secret", firstName: "Secret", phone: "9000000000" });
    const r = await call("POST", `/groups/${g._id}/members`, a, { contactId: bContact._id });
    expect(r.status).toBe(404);
  });

  it("a name typed into the email field gets a clear message, not 'Validation failed'", async () => {
    const a = mkUser("Arjun");
    const g = mkGroup("Flat", [a]);
    const r = await call("POST", `/groups/${g._id}/members`, a, { email: "Avni" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/doesn't look like an email/);
  });
});

// ---------------------------------------------------------------------------
describe("settlement flow", () => {
  async function setup() {
    const a = mkUser("Arjun"); // owes
    const b = mkUser("Bela"); // paid
    const c = mkUser("Chand"); // third member
    const outsider = mkUser("Omar");
    const g = mkGroup("Flat", [a, b, c]);
    const r = await call("POST", "/expenses", b, {
      groupId: g._id,
      title: "Groceries",
      amount: 300,
      splitMethod: "EQUAL",
      payers: [{ userId: b._id, amountPaid: 300 }],
      participants: [{ userId: a._id }, { userId: b._id }, { userId: c._id }],
    });
    expect(r.status).toBe(201);
    return { a, b, c, outsider, g };
  }

  it("creates and completes a settlement, and balances update", async () => {
    const { a, b, g } = await setup();

    const before = await call("GET", `/settlements/group/${g._id}/balances`, a);
    expect(before.status).toBe(200);
    const debt = before.body.suggestedSettlements.find((s: any) => s.fromUserId === a._id);
    expect(debt).toMatchObject({ toUserId: b._id, amount: 100 });

    const created = await call("POST", "/settlements", a, { groupId: g._id, toUserId: b._id, amount: 100, method: "UPI" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "PENDING", fromUserId: a._id, toUserId: b._id, amount: 100 });

    // Pending settlements do not change balances.
    const pending = await call("GET", `/settlements/group/${g._id}/balances`, a);
    expect(pending.body.suggestedSettlements.some((s: any) => s.fromUserId === a._id)).toBe(true);

    const completed = await call("POST", `/settlements/${created.body.id}/complete`, a);
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe("COMPLETED");

    const after = await call("GET", `/settlements/group/${g._id}/balances`, a);
    expect(after.body.balances.find((x: any) => x.userId === a._id).netBalance).toBeCloseTo(0, 2);
    expect(after.body.suggestedSettlements.some((s: any) => s.fromUserId === a._id)).toBe(false);

    const again = await call("POST", `/settlements/${created.body.id}/complete`, a);
    expect(again.status).toBe(409);
  });

  it("the recipient may complete it too", async () => {
    const { a, b, g } = await setup();
    const created = await call("POST", "/settlements", a, { groupId: g._id, toUserId: b._id, amount: 100 });
    const r = await call("POST", `/settlements/${created.body.id}/complete`, b);
    expect(r.status).toBe(200);
  });

  it("a third group member cannot complete someone else's settlement", async () => {
    const { a, b, c, g } = await setup();
    const created = await call("POST", "/settlements", a, { groupId: g._id, toUserId: b._id, amount: 100 });
    const r = await call("POST", `/settlements/${created.body.id}/complete`, c);
    expect(r.status).toBe(403);
    expect(settlements.docs[0].status).toBe("PENDING");
  });

  it("a non-member cannot complete a settlement", async () => {
    const { a, b, outsider, g } = await setup();
    const created = await call("POST", "/settlements", a, { groupId: g._id, toUserId: b._id, amount: 100 });
    const r = await call("POST", `/settlements/${created.body.id}/complete`, outsider);
    expect(r.status).toBe(403);
  });

  it("rejects paying a non-member or yourself", async () => {
    const { a, outsider, g } = await setup();
    expect((await call("POST", "/settlements", a, { groupId: g._id, toUserId: outsider._id, amount: 50 })).status).toBe(400);
    expect((await call("POST", "/settlements", a, { groupId: g._id, toUserId: a._id, amount: 50 })).status).toBe(400);
    expect(settlements.docs).toHaveLength(0);
  });

  it("a non-member cannot create a settlement in the group", async () => {
    const { b, outsider, g } = await setup();
    const r = await call("POST", "/settlements", outsider, { groupId: g._id, toUserId: b._id, amount: 50 });
    expect(r.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe("recurring expense membership", () => {
  const body = (g: Doc, payer: string, participants: string[], startDate: Date) => ({
    groupId: g._id,
    title: "Rent",
    amount: 900,
    splitMethod: "EQUAL",
    payers: [{ userId: payer, amountPaid: 900 }],
    participants: participants.map((userId) => ({ userId })),
    frequency: "MONTHLY",
    startDate: startDate.toISOString(),
  });

  it("rejects non-member participants at creation", async () => {
    const a = mkUser("Arjun");
    const outsider = mkUser("Omar");
    const g = mkGroup("Flat", [a]);
    const r = await call("POST", "/recurring-expenses", a, body(g, a._id, [a._id, outsider._id], new Date()));
    expect(r.status).toBe(400);
    expect(recurring.docs).toHaveLength(0);
  });

  it("generates when everyone is still a member, pauses when someone left", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const a = mkUser("Arjun");
    const b = mkUser("Bela");
    const c = mkUser("Chand");
    const g = mkGroup("Flat", [a, b, c]);

    const ok = await call("POST", "/recurring-expenses", a, body(g, a._id, [a._id, b._id], new Date(Date.now() - DAY)));
    expect(ok.status).toBe(201);
    const left = await call("POST", "/recurring-expenses", a, body(g, a._id, [a._id, c._id], new Date(Date.now() - DAY)));
    expect(left.status).toBe(201);
    members.docs.find((m) => m.userId === c._id)!.status = "LEFT";

    const result = await runRecurringGeneration();
    expect(result).toEqual({ generated: 1, recovered: 0, paused: 1, errors: 0 });
    expect(expenses.docs).toHaveLength(1);
    expect(expenses.docs[0].participants.map((p: any) => p.userId).sort()).toEqual([a._id, b._id].sort());
    expect(recurring.docs.find((r) => r._id === left.body.id)!.isActive).toBe(false);
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
describe("recurring scheduler reliability (exactly-once, partial failures)", () => {
  async function schedule(startDate: Date) {
    const a = mkUser("Arjun");
    const b = mkUser("Bela");
    const g = mkGroup("Flat", [a, b]);
    const r = await call("POST", "/recurring-expenses", a, {
      groupId: g._id,
      title: "Rent",
      amount: 900,
      splitMethod: "EQUAL",
      payers: [{ userId: a._id, amountPaid: 900 }],
      participants: [{ userId: a._id }, { userId: b._id }],
      frequency: "MONTHLY",
      startDate: startDate.toISOString(),
    });
    expect(r.status).toBe(201);
    return { a, row: () => recurring.docs.find((d) => d._id === r.body.id)! };
  }
  const monthsLater = (d: Date, n: number) => {
    const x = new Date(d);
    x.setMonth(x.getMonth() + n);
    return x;
  };
  let errSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("expense created but schedule update fails: next run recovers without a duplicate", async () => {
    const start = new Date(Date.now() - DAY);
    const { row } = await schedule(start);
    jest.spyOn(recurring as any, "updateOne").mockRejectedValueOnce(new Error("simulated write failure"));

    const first = await runRecurringGeneration();
    expect(first).toEqual({ generated: 0, recovered: 0, paused: 0, errors: 1 });
    expect(expenses.docs).toHaveLength(1); // the insert went through
    expect(new Date(row().nextOccurrence).getTime()).toBe(start.getTime()); // but the schedule did not move

    const second = await runRecurringGeneration();
    expect(second).toEqual({ generated: 0, recovered: 1, paused: 0, errors: 0 });
    expect(expenses.docs).toHaveLength(1); // duplicate guard held — still exactly one
    expect(new Date(row().nextOccurrence).getTime()).toBe(monthsLater(start, 1).getTime()); // and it is no longer stuck

    const third = await runRecurringGeneration();
    expect(third).toEqual({ generated: 0, recovered: 0, paused: 0, errors: 0 });
    expect(expenses.docs).toHaveLength(1);
  });

  it("insert fails with a database error: nothing advances and the next run generates it once", async () => {
    const start = new Date(Date.now() - DAY);
    const { row } = await schedule(start);
    jest.spyOn(expenses as any, "create").mockRejectedValueOnce(new Error("simulated timeout"));

    expect(await runRecurringGeneration()).toEqual({ generated: 0, recovered: 0, paused: 0, errors: 1 });
    expect(expenses.docs).toHaveLength(0);
    expect(new Date(row().nextOccurrence).getTime()).toBe(start.getTime());

    expect(await runRecurringGeneration()).toEqual({ generated: 1, recovered: 0, paused: 0, errors: 0 });
    expect(expenses.docs).toHaveLength(1);
    expect(new Date(row().nextOccurrence).getTime()).toBe(monthsLater(start, 1).getTime());
  });

  it("two concurrent runs create the occurrence once and advance the schedule once", async () => {
    const start = new Date(Date.now() - DAY);
    const { row } = await schedule(start);

    const [r1, r2] = await Promise.all([runRecurringGeneration(), runRecurringGeneration()]);
    expect(r1.generated + r2.generated).toBe(1);
    expect(r1.recovered + r2.recovered).toBe(1);
    expect(r1.errors + r2.errors).toBe(0);
    expect(expenses.docs).toHaveLength(1);
    expect(new Date(row().nextOccurrence).getTime()).toBe(monthsLater(start, 1).getTime()); // advanced once, not twice
  });

  it("a schedule that is behind catches up one occurrence per run, each exactly once", async () => {
    const start = monthsLater(new Date(Date.now() + DAY), -3); // 3 occurrences are due
    const { row } = await schedule(start);

    for (let i = 0; i < 5; i++) await runRecurringGeneration();
    expect(expenses.docs).toHaveLength(3);
    expect(new Set(expenses.docs.map((e) => e.recurringOccurrenceDate)).size).toBe(3);
    expect(new Date(row().nextOccurrence).getTime()).toBe(monthsLater(start, 3).getTime());
  });

  it("a paused schedule never generates", async () => {
    const { a, row } = await schedule(new Date(Date.now() - DAY));
    expect((await call("POST", `/recurring-expenses/${row()._id}/pause`, a)).status).toBe(200);
    await runRecurringGeneration();
    await runRecurringGeneration();
    expect(expenses.docs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("receipt scan error responses (OCR provider calls mocked)", () => {
  const VISION_KEY = "AIzaVisionSecretKey_0123456789abcdef";
  const savedEnv = { ...process.env };
  const realFetch = global.fetch;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    for (const k of ["GOOGLE_VISION_API_KEY", "GOOGLE_SPEECH_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "OCR_PROVIDER"]) delete process.env[k];
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    global.fetch = realFetch;
    warnSpy.mockRestore();
  });

  /** Local requests go to the test server; provider requests get `provider`. */
  function routeFetch(provider: (url: string) => any) {
    global.fetch = (async (url: any, init: any) =>
      String(url).startsWith("http://127.0.0.1") ? realFetch(url, init) : provider(String(url))) as any;
  }

  async function scan(user: Doc, groupId: string) {
    const fd = new FormData();
    fd.append("groupId", groupId);
    fd.append("image", new Blob([Buffer.from("fake-jpeg")], { type: "image/jpeg" }), "receipt.jpg");
    const res = await realFetch(`${base}/receipts/scan`, { method: "POST", headers: { authorization: `Bearer ${tokenFor(user)}` }, body: fd });
    return { status: res.status, body: (await res.json()) as any };
  }

  it("returns a friendly 422 without provider details or keys when OCR fails", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    routeFetch(() => ({ ok: false, status: 403, text: async () => `API key ${VISION_KEY} not valid. Please pass a valid API key.` }));
    const a = mkUser("Arjun");
    const g = mkGroup("Flat", [a]);

    const r = await scan(a, g._id);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("OCR_FAILED");
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(VISION_KEY);
    expect(text).not.toMatch(/Google Vision|HTTP 403|API key|google_vision/);
    // The detailed (redacted) reason is logged server-side instead.
    const logged = warnSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("HTTP 403");
    expect(logged).not.toContain(VISION_KEY);
  });

  it("returns a friendly 503 without env-var names when no OCR provider is configured", async () => {
    routeFetch(() => {
      throw new Error("no provider should be called");
    });
    const a = mkUser("Arjun");
    const g = mkGroup("Flat", [a]);
    const r = await scan(a, g._id);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("OCR_UNAVAILABLE");
    expect(JSON.stringify(r.body)).not.toMatch(/API_KEY|Render|GEMINI|GOOGLE/);
  });
});

// ---------------------------------------------------------------------------
describe("voice parsing with group inference (offline heuristic parser)", () => {
  it("infers the group from the people mentioned and returns the draft", async () => {
    const me = mkUser("Arjun");
    const rahul = mkUser("Rahul");
    const dev = mkUser("Dev");
    const college = mkGroup("College", [me, rahul], new Date(Date.now() - 30 * DAY));
    mkGroup("Office", [me, dev], new Date(Date.now() - 1 * DAY)); // more recent, but Rahul isn't in it

    const r = await call("POST", "/expenses/parse", me, { utterance: "Dinner 1200 with Rahul" });
    expect(r.status).toBe(200);
    expect(r.body.groupId).toBe(college._id);
    expect(r.body.groupName).toBe("College");
    expect(r.body.groupInference).toMatchObject({ inferred: true, confidence: "high" });
    expect(r.body.draft.amount).toBe(1200);
    expect(r.body.resolvedMentions.Rahul).toMatchObject({ status: "RESOLVED", userId: rahul._id });
    expect(r.body.needsDisambiguation).toBe(false);
  });

  it("infers the group from a spoken group name", async () => {
    const me = mkUser("Arjun");
    mkGroup("Flatmates", [me], new Date(Date.now() - 1 * DAY));
    const goa = mkGroup("Goa Trip", [me], new Date(Date.now() - 20 * DAY));
    const r = await call("POST", "/expenses/parse", me, { utterance: "Taxi 650 on the Goa trip" });
    expect(r.status).toBe(200);
    expect(r.body.groupId).toBe(goa._id);
    expect(r.body.groupInference.reason).toBe('You mentioned "Goa Trip"');
    expect(r.body.draft.amount).toBe(650);
  });

  it("uses the explicit group when one is supplied", async () => {
    const me = mkUser("Arjun");
    const g1 = mkGroup("One", [me]);
    mkGroup("Two", [me]);
    const r = await call("POST", "/expenses/parse", me, { groupId: g1._id, utterance: "Coffee 200" });
    expect(r.status).toBe(200);
    expect(r.body.groupId).toBe(g1._id);
    expect(r.body.groupInference.inferred).toBe(false);
  });

  it("refuses an explicit group the user isn't in", async () => {
    const me = mkUser("Arjun");
    const other = mkUser("Omar");
    const g = mkGroup("Theirs", [other]);
    const r = await call("POST", "/expenses/parse", me, { groupId: g._id, utterance: "Coffee 200" });
    expect(r.status).toBe(403);
  });

  it("returns NO_GROUPS when the user has no groups", async () => {
    const me = mkUser("Arjun");
    const r = await call("POST", "/expenses/parse", me, { utterance: "Coffee 200" });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("NO_GROUPS");
  });

  it("requires authentication", async () => {
    const r = await call("POST", "/expenses/parse", undefined, { utterance: "Coffee 200" });
    expect(r.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe("AI routes go through the service layer (providers mocked)", () => {
  const savedEnv = { ...process.env };
  const realFetch = global.fetch;
  let warnSpy: jest.SpyInstance;
  const GEMINI_KEY = "gem_route_secret_key";

  beforeEach(() => {
    clearAiEnv();
    resetAiWarnings();
    resetAssemblyAiCircuitBreaker();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    (saveFile as jest.Mock).mockResolvedValue({ storageKey: "receipt-key-1", sizeBytes: 3 });
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    global.fetch = realFetch;
    warnSpy.mockRestore();
  });

  /** Local requests reach the test server; anything else is a (mocked) provider call. */
  function providers(handler: (url: string, init: any) => any) {
    const fn = jest.fn(handler);
    global.fetch = (async (url: any, init: any) =>
      String(url).startsWith("http://127.0.0.1") ? realFetch(url, init) : fn(String(url), init)) as any;
    return fn;
  }
  const gemini = (text: string) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });

  async function upload(path: string, user: Doc, field: string, fields: Record<string, string> = {}) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append(field, new Blob([Buffer.from("fake-bytes")], { type: field === "audio" ? "audio/m4a" : "image/jpeg" }), field === "audio" ? "a.m4a" : "r.jpg");
    const res = await realFetch(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${tokenFor(user)}` }, body: fd });
    return { status: res.status, body: (await res.json()) as any };
  }

  it("POST /receipts/scan returns a validated draft with status ok", async () => {
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    providers(() => gemini("CAFE COFFEE DAY\n12/03/2026\nTOTAL 320.00"));
    const a = mkUser("Arjun");
    const g = mkGroup("Flat", [a]);
    const r = await upload("/receipts/scan", a, "image", { groupId: g._id });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "ok", provider: "gemini", amount: 320, merchant: "CAFE COFFEE DAY", needsReview: false, receiptStorageKey: "receipt-key-1" });
  });

  it("POST /receipts/scan flags needs_confirmation for review and drops invalid fields", async () => {
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    providers(() => gemini("BIG BAZAAR SUPERMARKET\nthanks"));
    const a = mkUser("Arjun");
    const g = mkGroup("Flat", [a]);
    const r = await upload("/receipts/scan", a, "image", { groupId: g._id });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "needs_confirmation", amount: null, needsReview: true });
    expect(r.body.reviewMessage).toMatch(/review/);
  });

  it("POST /voice/transcribe returns the transcript and the provider used", async () => {
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    providers(() => gemini("Dinner 1200 with Rahul"));
    const a = mkUser("Arjun");
    const r = await upload("/voice/transcribe", a, "audio");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ transcript: "Dinner 1200 with Rahul", provider: "gemini" });
  });

  it("POST /voice/transcribe: friendly 503 with no env-var names when nothing is configured", async () => {
    const fn = providers(() => {
      throw new Error("no provider should be called");
    });
    const r = await upload("/voice/transcribe", mkUser("Arjun"), "audio");
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("STT_UNAVAILABLE");
    expect(JSON.stringify(r.body)).not.toMatch(/API_KEY|ASSEMBLY|GROQ|GEMINI/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("POST /voice/transcribe: friendly 422 without provider details or keys when providers fail", async () => {
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    providers(() => ({ ok: false, status: 500, text: async () => `internal error, key ${GEMINI_KEY}` }));
    const r = await upload("/voice/transcribe", mkUser("Arjun"), "audio");
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("STT_FAILED");
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(GEMINI_KEY);
    expect(text).not.toMatch(/HTTP 500|gemini/i);
    expect(warnSpy.mock.calls.flat().join(" ")).not.toContain(GEMINI_KEY);
  });

  it("POST /expenses/parse reports status ok when a provider returns a valid draft", async () => {
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    providers(() =>
      gemini(JSON.stringify({ title: "Dinner", amount: 1200, participantMentions: ["me", "Rahul"], payerMentions: [{ mention: "me", amountPaid: 1200 }] }))
    );
    const me = mkUser("Arjun");
    const rahul = mkUser("Rahul");
    const g = mkGroup("College", [me, rahul]);
    const r = await call("POST", "/expenses/parse", me, { utterance: "Dinner 1200 with Rahul" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "ok", provider: "gemini", issues: [], groupId: g._id });
    expect(r.body.draft).toMatchObject({ title: "Dinner", amount: 1200 });
    expect(r.body.resolvedMentions.Rahul).toMatchObject({ status: "RESOLVED", userId: rahul._id });
  });

  it("POST /expenses/parse falls back to the offline heuristic as needs_confirmation", async () => {
    const me = mkUser("Arjun");
    mkGroup("Flat", [me]);
    const r = await call("POST", "/expenses/parse", me, { utterance: "Coffee 200" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "needs_confirmation", provider: "heuristic" });
    expect(r.body.draft.amount).toBe(200);
    expect(r.body.issues[0]).toMatch(/offline/);
  });
});

