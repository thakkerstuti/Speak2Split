import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "./api";

/**
 * Centralized Socket.IO connection lifecycle.
 *
 * There is exactly ONE socket instance for the whole app, created lazily
 * on login and torn down on logout — screens never create their own
 * connections. This avoids the "new socket per screen render" bug the
 * spec explicitly warns about, and means reconnection/auth is handled in
 * one place rather than duplicated across every screen that wants
 * real-time updates.
 */

let socket: Socket | null = null;

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

type StateListener = (state: ConnectionState) => void;
const stateListeners = new Set<StateListener>();
let currentState: ConnectionState = "disconnected";

function setState(next: ConnectionState) {
  currentState = next;
  stateListeners.forEach((l) => l(next));
}

export function getConnectionState(): ConnectionState {
  return currentState;
}

export function onConnectionStateChange(listener: StateListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/** Connects (or reuses) the socket, authenticated with the current session's JWT. */
export function connectRealtime(token: string): Socket {
  if (socket?.connected && socket.auth && (socket.auth as { token?: string }).token === token) {
    return socket;
  }

  // A token change (e.g. re-login as a different user) means the old
  // connection is stale and must be fully torn down first — otherwise we'd
  // silently keep listening to events under someone else's identity.
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  setState("connecting");
  socket = io(API_BASE_URL, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socket.on("connect", () => setState("connected"));
  socket.on("disconnect", () => setState("disconnected"));
  socket.on("reconnect_attempt", () => setState("reconnecting"));
  socket.on("connect_error", () => setState("error"));

  return socket;
}

/** Full teardown — call on logout so no stale listeners/rooms survive into the next session. */
export function disconnectRealtime() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  setState("disconnected");
}

export function getSocket(): Socket | null {
  return socket;
}
