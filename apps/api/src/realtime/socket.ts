import { Server as IOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config";
import { assertMembership } from "../groups/groups.router";

let io: IOServer | null = null;

export function initRealtime(httpServer: HTTPServer) {
  io = new IOServer(httpServer, {
    cors: { origin: process.env.CORS_ALLOWED_ORIGINS?.split(",") ?? "*" },
  });

  // Authenticate every socket connection with the same JWT used for REST.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Missing auth token"));
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error("Invalid auth token"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("join_group", async (groupId: string) => {
      // Re-verify group membership server-side before allowing the room
      // join — exactly like every REST route does. Without this, an
      // authenticated-but-unrelated user could join any group's room by
      // ID and receive its real-time events even without REST access to
      // that group's data.
      try {
        const isMember = await assertMembership(groupId, socket.data.userId);
        if (!isMember) {
          socket.emit("join_group_error", { groupId, error: "Not a member of this group" });
          return;
        }
        socket.join(`group:${groupId}`);
      } catch (err) {
        socket.emit("join_group_error", { groupId, error: "Failed to verify group membership" });
      }
    });
    socket.on("leave_group", (groupId: string) => {
      socket.leave(`group:${groupId}`);
    });
  });

  return io;
}

export function broadcastToGroup(groupId: string, event: string, payload: unknown) {
  io?.to(`group:${groupId}`).emit(event, payload);
}
