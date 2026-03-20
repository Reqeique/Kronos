// Mock Prisma client to avoid better-sqlite3 native dependency on Vercel
// This allows the demo branch to build and run without a real database

const mockDbData = {
    user: {
        findUnique: async () => ({ id: "1", email: "demo@example.com", name: "Demo User" }),
        findFirst: async () => ({ id: "1", email: "demo@example.com", name: "Demo User" }),
        findMany: async () => [],
        create: async () => ({ id: "1", email: "demo@example.com", name: "Demo User" }),
        update: async () => ({ id: "1", email: "demo@example.com", name: "Demo User" }),
        delete: async () => ({ id: "1", email: "demo@example.com", name: "Demo User" }),
        count: async () => 0,
    },
    agent: {
        findUnique: async () => null,
        findFirst: async () => null,
        findMany: async () => [],
        create: async () => ({ id: "agent-1", name: "Demo Agent" }),
        update: async () => ({ id: "agent-1", name: "Demo Agent" }),
        delete: async () => ({ id: "agent-1", name: "Demo Agent" }),
        count: async () => 0,
    },
    taskRun: {
        findUnique: async () => null,
        findFirst: async () => null,
        findMany: async () => [],
        create: async () => ({ id: "run-1", status: "completed" }),
        update: async () => ({ id: "run-1", status: "completed" }),
        delete: async () => ({ id: "run-1", status: "completed" }),
        count: async () => 0,
    }
};

const createMockProxy = (target: any = {}) => {
    return new Proxy(target, {
        get(obj, prop: string) {
            if (prop in obj) return obj[prop];
            if (prop === 'then') return undefined; // NOT a Promise
            
            // If the property requested exists in our mock data, return it
            if (mockDbData[prop as keyof typeof mockDbData]) {
                return mockDbData[prop as keyof typeof mockDbData];
            }
            
            // Otherwise, return a function that returns an empty array to be safe for findMany
            return async () => [];
        }
    });
};

export const prisma = createMockProxy() as any;
export default prisma;
