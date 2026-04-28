import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

interface JwtPayload {
  id: string;
  email: string;
  role: string;
}

interface AuthSocket extends Socket {
  user?: JwtPayload;
}

const initSocket = (io: Server) => {
  io.use(async (socket: AuthSocket, next) => {
    try {
      const cookieHeader = socket.handshake.headers?.cookie ?? "";
      const token =
        socket.handshake.auth?.token ||
        cookieHeader
          .split(";")
          .find((c: string) => c.trim().startsWith("jwt="))
          ?.split("=")[1];

      if (!token) return next(new Error("Authentication error"));

      const user = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      socket.user = user;
      next();
    } catch {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket: AuthSocket) => {
    const user = socket.user!;
    console.log(`Connected: ${user.email} | Role: ${user.role}`);

    if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      socket.join("admin-room");
      console.log(`Admin ${user.email} joined secure admin-room`);
    }

    socket.join(user.id);
    console.log(`User ${user.id} joined their private notification room`);

    socket.on("disconnect", () => {
      console.log(`User ${user.email} disconnected`);
    });
  });
};

export default initSocket;
