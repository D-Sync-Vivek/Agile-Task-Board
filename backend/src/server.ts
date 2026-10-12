import { createServer } from "node:http";
import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { attachSocketServer } from "./sockets/socketServer";

// Express and Socket.IO share one HTTP server (and so one port, one deployment).
const server = createServer(createApp());
const io = attachSocketServer(server);

server.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  void io.close(async () => {
    // io.close() also closes the HTTP server.
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
