import { v4 as uuidv4 } from "uuid";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    traceId?: string;
    data?: Record<string, unknown>;
}

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

        const output = JSON.stringify(entry);

        switch (level) {
            case "error":
                console.error(output);
                break;
            case "warn":
                console.warn(output);
                break;
            case "debug":
                console.debug(output);
                break;
            default:
                console.log(output);
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

export const logger = new Logger();
export default logger;
