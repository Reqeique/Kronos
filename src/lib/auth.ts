import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const { handlers, signIn, signOut, auth } = NextAuth({
    trustHost: true,
    secret: process.env.NEXTAUTH_SECRET || "fallback-demo-secret-do-not-use-in-prod-12345",
    providers: [
        Credentials({
            name: "credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) return null;

                // Hardcoded demo user to avoid database requirements on Vercel
                return {
                    id: "1",
                    email: typeof credentials.email === "string" ? credentials.email : "demo@example.com",
                    name: "Demo User",
                };
            },
        }),
    ],
    session: {
        strategy: "jwt",
    },
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.userId = user.id;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user && token.userId) {
                (session.user as { id?: string }).id = token.userId as string;
            }
            return session;
        },
    },
    pages: {
        signIn: "/login",
    },
});
