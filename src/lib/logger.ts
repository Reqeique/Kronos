import { v4 as uuidv4 } from "uuid";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    traceId?: string;
    data?: Record<string, unknown>;
}

type Stream = "stdout" | "stderr";

class Logger {
    private level: LogLevel;

    private static readonly LEVELS: Record<LogLevel, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
    };

    constructor(level?: LogLevel) {
        this.level = level ?? (process.env.NODE_ENV === "development" ? "debug" : "info");
    }

    private shouldLog(level: LogLevel): boolean {
        return Logger.LEVELS[level] >= Logger.LEVELS[this.level];
    }

    private log(level: LogLevel, message: string, data?: Record<string, unknown>, traceId?: string) {
        if (!this.shouldLog(level)) return;

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            traceId,
            data,
        };

        let output: string;
        try {
            output = JSON.stringify(entry);
        } catch {
            output = JSON.stringify({
                timestamp: new Date().toISOString(),
                level,
                message: String(message).slice(0, 1000),
            });
        }

        const stream: Stream = level === "error" ? "stderr" : "stdout";
        const target: NodeJS.WriteStream = stream === "stdout" ? process.stdout : process.stderr;
        try {
            target.write(output + "\n");
        } catch {
            // epipeGuard (installed via src/instrumentation.ts -> src/lib/epipeGuard.ts)
            // captures orphaned-stdout writes to KRONOS_LOG_DIR. If the guard is
            // not installed (e.g. library import in tests), writes are silently no-op.
        }
    }

    debug(message: string, data?: Record<string, unknown>, traceId?: string) {
        this.log("debug", message, data, traceId);
    }

    info(message: string, data?: Record<string, unknown>, traceId?: string) {
        this.log("info", message, data, traceId);
    }

    warn(message: string, data?: Record<string, unknown>, traceId?: string) {
        this.log("warn", message, data, traceId);
    }

    error(message: string, data?: Record<string, unknown>, traceId?: string) {
        this.log("error", message, data, traceId);
    }

    /** Generate a new trace ID for request tracking */
    static newTraceId(): string {
        return uuidv4().split("-")[0];
    }
}

let loggerInstance: Logger | null = null;

export function getLogger(): Logger {
    if (!loggerInstance) loggerInstance = new Logger();
    return loggerInstance;
}

export const logger = getLogger();
export default logger;
