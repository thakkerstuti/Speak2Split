import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { UserModel } from "../db/models/User";
import { normalizePhone } from "@speak2split/shared";
import { verifyGoogleIdToken, GoogleAuthNotConfiguredError, InvalidGoogleTokenError } from "./google-auth";
import { verifyAppleIdToken, AppleAuthNotConfiguredError, InvalidAppleTokenError } from "./apple-auth";
import { JWT_SECRET } from "../config";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(1),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const authRouter = Router();

authRouter.post("/register", async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const { email, password, displayName, phone } = parsed.data;

    const existing = await UserModel.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await UserModel.create({
      email: email.toLowerCase(),
      passwordHash,
      displayName,
      firstName: displayName.split(" ")[0],
      phone,
      normalizedPhone: phone ? normalizePhone(phone) : undefined,
    });

    const token = jwt.sign({ sub: String(user._id) }, JWT_SECRET, { expiresIn: "30d" });
    return res.status(201).json({ token, user: { id: String(user._id), email: user.email, displayName: user.displayName } });
  } catch (err: any) {
    console.error("Error in /auth/register:", err);
    if (err?.code === 11000 || err?.name === "MongoServerError" || err?.message?.includes("E11000")) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    return res.status(500).json({ error: err?.message || "Registration failed" });
  }
});

authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const user = await UserModel.findOne({ email: email.toLowerCase(), isActive: true });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign({ sub: String(user._id) }, JWT_SECRET, { expiresIn: "30d" });
    return res.json({ token, user: { id: String(user._id), email: user.email, displayName: user.displayName } });
  } catch (err: any) {
    console.error("Error in /auth/login:", err);
    return res.status(500).json({ error: err?.message || "Login failed" });
  }
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const user = await UserModel.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json({
      id: String(user._id),
      email: user.email,
      displayName: user.displayName,
      defaultCurrency: user.defaultCurrency,
      avatarUrl: user.avatarUrl,
      authProviders: [
        ...(user.passwordHash ? ["EMAIL"] : []),
        ...user.authAccounts.map((a: { provider: string }) => a.provider),
      ],
    });
  } catch (err: any) {
    console.error("Error in /auth/me:", err);
    return res.status(500).json({ error: err?.message || "Profile fetch failed" });
  }
});

async function linkOrCreateUserForProvider(
  provider: "GOOGLE" | "APPLE",
  providerUserId: string,
  email: string | undefined,
  emailVerified: boolean,
  displayName: string | undefined,
  avatarUrl: string | undefined
) {
  const existingLink = await UserModel.findOne({
    authAccounts: { $elemMatch: { provider, providerUserId } },
  });
  if (existingLink) return existingLink;

  if (email && emailVerified) {
    const existingUser = await UserModel.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      existingUser.authAccounts.push({ provider, providerUserId, createdAt: new Date() });
      await existingUser.save();
      return existingUser;
    }
  }

  const finalDisplayName = displayName || (email ? email.split("@")[0] : `${provider} User`);
  const created = await UserModel.create({
    email: (email ?? `${provider.toLowerCase()}-${providerUserId}@no-email.speak2split.internal`).toLowerCase(),
    displayName: finalDisplayName,
    firstName: finalDisplayName.split(" ")[0],
    avatarUrl,
    isActive: true,
    authAccounts: [{ provider, providerUserId, createdAt: new Date() }],
  });
  return created;
}

const googleAuthSchema = z.object({ idToken: z.string().min(1) });

authRouter.post("/google", async (req: Request, res: Response) => {
  const parsed = googleAuthSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

  let identity;
  try {
    identity = await verifyGoogleIdToken(parsed.data.idToken);
  } catch (err) {
    if (err instanceof GoogleAuthNotConfiguredError) return res.status(503).json({ error: err.message });
    if (err instanceof InvalidGoogleTokenError) return res.status(401).json({ error: err.message });
    throw err;
  }

  const user = await linkOrCreateUserForProvider(
    "GOOGLE",
    identity.googleUserId,
    identity.email,
    identity.emailVerified,
    identity.name,
    identity.avatarUrl
  );

  const token = jwt.sign({ sub: String(user._id) }, JWT_SECRET, { expiresIn: "30d" });
  return res.json({ token, user: { id: String(user._id), email: user.email, displayName: user.displayName } });
});

const appleAuthSchema = z.object({
  identityToken: z.string().min(1),
  fullName: z.string().optional(),
});

authRouter.post("/apple", async (req: Request, res: Response) => {
  const parsed = appleAuthSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });

  let identity;
  try {
    identity = await verifyAppleIdToken(parsed.data.identityToken);
  } catch (err) {
    if (err instanceof AppleAuthNotConfiguredError) return res.status(503).json({ error: err.message });
    if (err instanceof InvalidAppleTokenError) return res.status(401).json({ error: err.message });
    throw err;
  }

  const user = await linkOrCreateUserForProvider(
    "APPLE",
    identity.appleUserId,
    identity.email,
    identity.emailVerified,
    parsed.data.fullName,
    undefined
  );

  const token = jwt.sign({ sub: String(user._id) }, JWT_SECRET, { expiresIn: "30d" });
  return res.json({ token, user: { id: String(user._id), email: user.email, displayName: user.displayName } });
});
