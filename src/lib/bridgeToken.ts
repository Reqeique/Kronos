import crypto from "node:crypto";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function base64UrlEncode(value: Buffer | string): string {
    const input = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    return input
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Buffer {
    const normalized = value
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Buffer.from(normalized, "base64");
}

function getSecret(): string {
    return process.env.KRONOS_BRIDGE_TOKEN_SECRET
        || process.env.NEXTAUTH_SECRET
        || "kronos-dev-bridge-secret";
}

function signPayload(payloadSegment: string): string {
    const digest = crypto
        .createHmac("sha256", getSecret())
        .update(payloadSegment)
        .digest();
    return base64UrlEncode(digest);
}

export interface BridgeTokenPayload {
    userId: string;
    exp: number;
}

export function createBridgeToken(userId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload: BridgeTokenPayload = {
        userId,
        exp: nowSeconds + Math.max(60, Math.floor(ttlSeconds)),
    };

    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = signPayload(encodedPayload);
    return `${encodedPayload}.${signature}`;
}

export function verifyBridgeToken(token: string | null | undefined): BridgeTokenPayload | null {
    if (!token) return null;

    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [encodedPayload, signature] = parts;
    if (!encodedPayload || !signature) return null;

    const expected = signPayload(encodedPayload);
    const signatureBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");

    if (signatureBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

    try {
        const parsed = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as Partial<BridgeTokenPayload>;
        if (!parsed?.userId || typeof parsed.userId !== "string") return null;
        if (!parsed.exp || typeof parsed.exp !== "number") return null;
        if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
        return {
            userId: parsed.userId,
            exp: parsed.exp,
        };
    } catch {
        return null;
    }
}
