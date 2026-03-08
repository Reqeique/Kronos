"use client";

export const WORKING_DIR_STORAGE_KEY = "kronos.settings.workingDir";

export function getWorkingDirectorySetting(): string {
    if (typeof window === "undefined") return "";
    try {
        return `${window.localStorage.getItem(WORKING_DIR_STORAGE_KEY) || ""}`.trim();
    } catch {
        return "";
    }
}

export function setWorkingDirectorySetting(value: string): void {
    if (typeof window === "undefined") return;
    const normalized = `${value || ""}`.trim();
    try {
        if (!normalized) {
            window.localStorage.removeItem(WORKING_DIR_STORAGE_KEY);
            return;
        }
        window.localStorage.setItem(WORKING_DIR_STORAGE_KEY, normalized);
    } catch {
        // no-op
    }
}
