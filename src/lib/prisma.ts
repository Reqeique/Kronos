import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "prisma", "dev.db");

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
    prismaReady: Promise<void> | undefined;
};

function createPrismaClient(): PrismaClient {
    const adapter = new PrismaBetterSqlite3({
        url: dbPath,
        timeout: 5_000,
    });
    return new PrismaClient({ adapter } as never);
}

const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// `journal_mode = WAL` is a per-database setting, not per-connection, so we
// only need to attempt it once per process. It lets readers proceed while a
// write commits, which matters because the dev server holds a single
// synchronous better-sqlite3 connection: one slow reader otherwise blocks
// every scheduler tick and POST handler. `busy_timeout` is the matching
// retry cushion so writers wait instead of failing instantly with
// SQLITE_BUSY when reads momentarily hold the lock.
const prismaReady =
    globalForPrisma.prismaReady ??
    (async () => {
        try {
            await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
            await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000;");
        } catch {
            // Fall back to the per-connection `timeout` option above.
        }
    })();

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaReady = prismaReady;

export async function ensurePrismaReady(): Promise<void> {
    await prismaReady;
    // Warm the connection. better-sqlite3 lazy-opens on first query; doing
    // it here ensures subsequent callers don't pay it inside a request.
    void prisma.$queryRawUnsafe("SELECT 1").catch(() => undefined);
}

export default prisma;
