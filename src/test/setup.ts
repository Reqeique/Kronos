import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock next-auth
vi.mock("next-auth", () => ({
    default: vi.fn(),
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    handlers: { GET: vi.fn(), POST: vi.fn() },
}));

// Mock Next.js router
vi.mock("next/navigation", () => ({
    useRouter: () => ({
        push: vi.fn(),
        replace: vi.fn(),
        prefetch: vi.fn(),
    }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "",
}));
