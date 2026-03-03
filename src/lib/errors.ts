import { NextResponse } from "next/server";
import logger from "./logger";
import type { ApiResponse } from "@/types";

// ─── Custom API Error ────────────────────────────────────
export class ApiError extends Error {
    constructor(
        public statusCode: number,
        public code: string,
        message: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

// Common errors
export const Errors = {
    unauthorized: () => new ApiError(401, "UNAUTHORIZED", "Authentication required"),
    forbidden: () => new ApiError(403, "FORBIDDEN", "Insufficient permissions"),
    notFound: (resource: string) => new ApiError(404, "NOT_FOUND", `${resource} not found`),
    conflict: (message: string) => new ApiError(409, "CONFLICT", message),
    badRequest: (message: string) => new ApiError(400, "BAD_REQUEST", message),
    internal: (message = "Internal server error") => new ApiError(500, "INTERNAL_ERROR", message),
};

// ─── Error Response Builder ──────────────────────────────
export function errorResponse(error: unknown): NextResponse<ApiResponse> {
    const traceId = logger.constructor.name === "Logger"
        ? (logger as unknown as { constructor: { newTraceId: () => string } }).constructor.newTraceId?.() ?? "unknown"
        : "unknown";

    if (error instanceof ApiError) {
        logger.warn(`API Error: ${error.code}`, {
            statusCode: error.statusCode,
            message: error.message,
        }, traceId);

        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                    traceId,
                },
            },
            { status: error.statusCode },
        );
    }

    // Unexpected errors
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Unhandled error", { message, stack: error instanceof Error ? error.stack : undefined }, traceId);

    return NextResponse.json(
        {
            success: false,
            error: {
                code: "INTERNAL_ERROR",
                message: process.env.NODE_ENV === "development" ? message : "Internal server error",
                traceId,
            },
        },
        { status: 500 },
    );
}

// ─── Success Response Builder ────────────────────────────
export function successResponse<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
    return NextResponse.json({ success: true, data }, { status });
}
