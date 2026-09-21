import mongoose from "mongoose";

/**
 * Single Mongoose connection for the whole API process, replacing the
 * previous `pg.Pool`. Every model file imports `mongoose` directly and
 * registers itself against this default connection — there's no need to
 * pass a connection handle around, mirroring how `pool` used to be
 * imported everywhere.
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

  mongoose.connection.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("MongoDB connection error:", err);
  });

  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
