import type { Metadata } from "next";
import "./globals.css";
import "./components.css";
import "@schedule-x/theme-shadcn/dist/index.css";

export const metadata: Metadata = {
    title: "Kronos — AI Agent Time Intelligence",
    description: "Visualize AI agent work as time blocks. Schedule, monitor, and analyze agent task duration.",
    keywords: ["AI agents", "calendar", "scheduling", "ACP", "monitoring"],
};

import { ThemeProvider } from "@/components/theme-provider";
import { Host_Grotesk } from "next/font/google";

const hostGrotesk = Host_Grotesk({
    subsets: ["latin"],
    variable: "--font-sans",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`${hostGrotesk.variable} font-sans antialiased bg-background text-foreground`}>
                <ThemeProvider
                    attribute="class"
                    defaultTheme="light"
                    enableSystem
                    disableTransitionOnChange
                >
                    {children}
                </ThemeProvider>
            </body>
        </html>
    );
}
