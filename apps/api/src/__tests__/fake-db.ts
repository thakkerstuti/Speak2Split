/**
 * Minimal in-memory stand-in for the Mongoose models, used ONLY by the route
 * tests in this folder. It implements just the query/aggregation features the
 * routes under test use (equality, $in, $ne, $exists, $gt/$gte/$lt/$lte, $or,
 * dotted paths; $match/$unwind/$group with $sum/$max). It is NOT MongoDB:
 * indexes, transactions and real casting behaviour are not exercised.
 */
import crypto from "crypto";

export type Doc = Record<string, any>;

export const newId = () => crypto.randomBytes(12).toString("hex");

function getPath(doc: Doc, path: string): any {
  return path.split(".").reduce<any>((v, k) => (v == null ? undefined : Array.isArray(v) ? v.map((x) => x?.[k]) : v[k]), doc);
}

const same = (a: any, b: any) => {
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return String(a) === String(b);
};

const isIdObject = (v: any) => v && typeof v === "object" && typeof v.toHexString === "function";

function matchValue(actual: any, cond: any): boolean {
  if (isIdObject(cond)) cond = cond.toHexString();
  if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date) && !(cond instanceof RegExp)) {
    return Object.entries(cond).every(([op, v]) => {
      const vals = Array.isArray(actual) ? actual : [actual];
      switch (op) {
        case "$in":
          return vals.some((a) => (v as any[]).some((x) => same(a, x)));
        case "$ne":
          return !vals.some((a) => same(a, v));
        case "$exists":
          return v ? actual !== undefined && actual !== null : actual === undefined || actual === null;
        case "$gt":
          return actual != null && new Date(actual) > new Date(v as any);
        case "$gte":
          return actual != null && (typeof v === "number" ? actual >= v : new Date(actual) >= new Date(v as any));
        case "$lt":
          return actual != null && new Date(actual) < new Date(v as any);
        case "$lte":
          return actual != null && (typeof v === "number" ? actual <= v : new Date(actual) <= new Date(v as any));
        default:
          throw new Error(`fake-db: unsupported operator ${op}`);
      }
    });
  }
  if (cond instanceof RegExp) return typeof actual === "string" && cond.test(actual);
  if (Array.isArray(actual)) return actual.some((a) => same(a, cond));
  return same(actual, cond);
}

export function matches(doc: Doc, filter: Doc = {}): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return (cond as Doc[]).some((f) => matches(doc, f));
    return matchValue(getPath(doc, key), cond);
  });
}

class Query<T> implements PromiseLike<T> {
  private sortSpec?: Record<string, number>;
  private limitN?: number;
  constructor(private readonly run: (q: Query<T>) => T) {}
  lean() {
    return this;
  }
  select() {
    return this;
  }
  session() {
    return this;
  }
  sort(spec: Record<string, number>) {
    this.sortSpec = spec;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  distinct(field: string): Promise<any[]> {
    const res = this.run(this) as any;
    const arr = Array.isArray(res) ? res : res ? [res] : [];
    return Promise.resolve([...new Set(arr.map((d: Doc) => String(getPath(d, field))))]);
  }
  shape(list: Doc[]): Doc[] {
    let out = [...list];
    if (this.sortSpec) {
      const [[k, dir]] = Object.entries(this.sortSpec);
      out.sort((a, b) => (a[k] > b[k] ? dir : a[k] < b[k] ? -dir : 0));
    }
    if (this.limitN !== undefined) out = out.slice(0, this.limitN);
    return out;
  }
  exec() {
    return Promise.resolve(this.run(this));
  }
  then<A, B>(onF?: ((v: T) => A | PromiseLike<A>) | null, onR?: ((e: any) => B | PromiseLike<B>) | null) {
    return this.exec().then(onF, onR);
  }
}

export class FakeModel {
  docs: Doc[] = [];
  /** Mirrors the schema defaults of the real model (applied on insert). */
  defaults: Doc = {};
  /**
   * Mirrors real unique indexes: each entry is a list of fields plus an
   * optional "only when this field exists" partial filter. Violations throw
   * an error with code 11000, like the MongoDB driver.
   */
  uniqueIndexes: { fields: string[]; partialExists?: string }[] = [];
  constructor(readonly name: string) {}

  private wrap(doc: Doc | undefined | null): Doc | null {
    if (!doc) return null;
    const self = this;
    const copy: Doc = { ...doc };
    Object.defineProperties(copy, {
      save: {
        enumerable: false,
        value: async () => {
          const i = self.docs.findIndex((d) => d._id === copy._id);
          const plain = JSON.parse(JSON.stringify({ ...copy }));
          if (i >= 0) self.docs[i] = { ...self.docs[i], ...plain, updatedAt: new Date() };
          return copy;
        },
      },
      toJSON: {
        enumerable: false,
        value: () => {
          const { _id, ...rest } = copy;
          return { ...rest, id: String(_id) };
        },
      },
      deleteOne: {
        enumerable: false,
        value: async () => {
          self.docs = self.docs.filter((d) => d._id !== copy._id);
        },
      },
    });
    return copy;
  }

  insert(data: Doc): Doc {
    const doc: Doc = { _id: newId(), createdAt: new Date(), updatedAt: new Date(), ...this.defaults, ...data };
    for (const idx of this.uniqueIndexes) {
      if (idx.partialExists && doc[idx.partialExists] == null) continue;
      const clash = this.docs.some(
        (d) => (!idx.partialExists || d[idx.partialExists] != null) && idx.fields.every((f) => same(getPath(d, f), getPath(doc, f)))
      );
      if (clash) throw Object.assign(new Error(`E11000 duplicate key error (${this.name}: ${idx.fields.join(", ")})`), { code: 11000 });
    }
    this.docs.push(doc);
    return doc;
  }

  find(filter: Doc = {}) {
    return new Query<Doc[]>((q) => q.shape(this.docs.filter((d) => matches(d, filter))).map((d) => this.wrap(d)!));
  }
  findOne(filter: Doc = {}) {
    return new Query<Doc | null>(() => this.wrap(this.docs.find((d) => matches(d, filter))));
  }
  findById(id: string) {
    return new Query<Doc | null>(() => this.wrap(this.docs.find((d) => String(d._id) === String(id))));
  }
  exists(filter: Doc = {}) {
    return Promise.resolve(this.docs.some((d) => matches(d, filter)) ? { _id: "x" } : null);
  }
  async create(data: Doc | Doc[]) {
    if (Array.isArray(data)) return data.map((d) => this.wrap(this.insert(d))!);
    return this.wrap(this.insert(data))!;
  }
  async updateOne(filter: Doc, update: Doc) {
    const d = this.docs.find((x) => matches(x, filter));
    if (d) applyUpdate(d, update);
    return { acknowledged: true, matchedCount: d ? 1 : 0, modifiedCount: d ? 1 : 0 };
  }
  async updateMany(filter: Doc, update: Doc) {
    for (const d of this.docs.filter((x) => matches(x, filter))) applyUpdate(d, update);
    return { acknowledged: true };
  }
  async findOneAndUpdate(filter: Doc, update: Doc, opts: { upsert?: boolean } = {}) {
    let d = this.docs.find((x) => matches(x, filter));
    if (!d && opts.upsert) d = this.insert({ ...filter, ...(update.$setOnInsert ?? {}) });
    if (d) applyUpdate(d, update);
    return this.wrap(d);
  }
  async aggregate(pipeline: Doc[]) {
    let rows: Doc[] = this.docs.map((d) => ({ ...d }));
    for (const stage of pipeline) {
      if (stage.$match) rows = rows.filter((r) => matches(r, stage.$match));
      else if (stage.$unwind) {
        const field = String(stage.$unwind).slice(1);
        rows = rows.flatMap((r) => (r[field] ?? []).map((item: any) => ({ ...r, [field]: item })));
      } else if (stage.$group) {
        const { _id, ...acc } = stage.$group;
        const groups = new Map<string, Doc>();
        for (const r of rows) {
          const key = getPath(r, String(_id).slice(1));
          const g = groups.get(String(key)) ?? { _id: key };
          for (const [name, spec] of Object.entries<any>(acc)) {
            if (spec.$sum !== undefined) g[name] = (g[name] ?? 0) + Number(getPath(r, String(spec.$sum).slice(1)) ?? 0);
            if (spec.$max !== undefined) {
              const v = getPath(r, String(spec.$max).slice(1));
              g[name] = g[name] === undefined || v > g[name] ? v : g[name];
            }
          }
          groups.set(String(key), g);
        }
        rows = [...groups.values()];
      } else throw new Error(`fake-db: unsupported stage ${Object.keys(stage)[0]}`);
    }
    return rows;
  }
}

function applyUpdate(d: Doc, update: Doc) {
  if (update.$set) Object.assign(d, update.$set);
  if (update.$inc) for (const [k, v] of Object.entries<number>(update.$inc)) d[k] = (d[k] ?? 0) + v;
}

class FakeDb {
  models = new Map<string, FakeModel>();
  model(name: string) {
    if (!this.models.has(name)) this.models.set(name, new FakeModel(name));
    return this.models.get(name)!;
  }
  reset() {
    for (const m of this.models.values()) m.docs = [];
  }
}

export const fakeDb = new FakeDb();
