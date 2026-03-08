import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { errorResponse, Errors, successResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IGNORED_DIRS = new Set([
    ".git",
    ".next",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "playwright-report",
    "test-results",
]);

const MAX_RESULTS = 12;
const CACHE_TTL_MS = 15_000;

const cache = new Map<string, { expiresAt: number; files: string[] }>();

function normalizePath(inputPath: string): string {
    return inputPath.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").trim();
}

function buildProjectFileIndex(rootDir: string): string[] {
    const out: string[] = [];
    const stack = [rootDir];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;

        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) stack.push(fullPath);
                continue;
            }

            if (!entry.isFile()) continue;
            const rel = normalizePath(path.relative(rootDir, fullPath));
            if (rel) out.push(rel);
        }
    }

    out.sort((a, b) => a.localeCompare(b));
    return out;
}

function getProjectFiles(rootDir: string): string[] {
    const now = Date.now();
    const cached = cache.get(rootDir);
    if (cached && cached.expiresAt > now) return cached.files;

    const files = buildProjectFileIndex(rootDir);
    cache.set(rootDir, { files, expiresAt: now + CACHE_TTL_MS });
    return files;
}

function resolveSuggestionRoot(cwdQuery: string | null): string {
    const projectRoot = process.cwd();
    const raw = `${cwdQuery || ""}`.trim();
    if (!raw) return projectRoot;

    const candidate = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(projectRoot, raw);
    if (!fs.existsSync(candidate)) {
        throw Errors.badRequest("cwd does not exist");
    }
    if (!fs.statSync(candidate).isDirectory()) {
        throw Errors.badRequest("cwd must be a directory");
    }

    return candidate;
}

function rankMatches(files: string[], rawQuery: string): string[] {
    const query = normalizePath(rawQuery).replace(/^@+/, "").toLowerCase();
    if (!query) return files.slice(0, MAX_RESULTS);

    const prefix: string[] = [];
    const contains: string[] = [];

    for (const file of files) {
        const lower = file.toLowerCase();
        if (lower.startsWith(query)) {
            prefix.push(file);
        } else if (lower.includes(query)) {
            contains.push(file);
        }
        if (prefix.length + contains.length >= MAX_RESULTS * 3) break;
    }

    return [...prefix, ...contains].slice(0, MAX_RESULTS);
}

// GET /api/files/suggest?q=src/comp
export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) throw Errors.unauthorized();

        const { searchParams } = new URL(req.url);
        const q = `${searchParams.get("q") || ""}`.trim();
        const rootDir = resolveSuggestionRoot(searchParams.get("cwd"));
        const files = getProjectFiles(rootDir);
        const suggestions = rankMatches(files, q);
        return successResponse({ suggestions });
    } catch (error) {
        return errorResponse(error);
    }
}
