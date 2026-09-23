import mongoose from "mongoose";

/**
 * Single Mongoose connection for the whole API process. Every model file
 * imports `mongoose` directly and registers itself against this default
 * connection handle.
 */
export async function connectMongo(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not configured. Set it in your environment — see ENVIRONMENT.md / .env.example (e.g. mongodb://localhost:27017/speak2split or a MongoDB Atlas connection string)."
    );
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  // Cleanup obsolete/legacy indexes (e.g., id_1 from previous raw SQL or early schema migrations)
  try {
    const db = mongoose.connection.db;
    if (db) {
      const usersColl = db.collection("users");
      const indexes = await usersColl.indexes().catch(() => []);
      const hasIdIndex = indexes.some((idx: any) => idx.name === "id_1" || (idx.key && idx.key.id));
      if (hasIdIndex) {
        console.log("[MongoDB] Dropping obsolete index 'id_1' from users collection...");
        await usersColl.dropIndex("id_1").catch((e) => console.warn("[MongoDB] Warning dropping id_1 index:", e.message));
      }
      // Unset obsolete 'id' field from any existing documents
      await usersColl.updateMany({ id: { $exists: true } }, { $unset: { id: "" } }).catch(() => {});
    }
  } catch (err: any) {
    console.warn("[MongoDB] Index cleanup check error:", err.message);
  }

  mongoose.connection.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("MongoDB connection error:", err);
  });

  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
