"use client";

import { FormEvent, useState, Suspense, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Mail, Lock, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Mode = "signin" | "register";

function LoginContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [mode, setMode] = useState<Mode>("signin");
    const [email, setEmail] = useState("");
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const authError = searchParams.get("error");

    // In demo mode, skip login and go straight to the dashboard
    useEffect(() => {
        router.replace("/dashboard");
    }, [router]);

    return (
        <div className="min-h-screen flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
        </div>
    );


    async function handleSignIn(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const result = await signIn("credentials", {
                email,
                password,
                redirect: false,
            });
            if (!result?.ok) {
                setError("Invalid email or password.");
                return;
            }
            router.push("/");
            router.refresh();
        } catch {
            setError("Unable to sign in right now.");
        } finally {
            setLoading(false);
        }
    }

    async function handleRegister(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password, name: name || null }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                setError(data?.error?.message ?? "Could not create account.");
                return;
            }

            const result = await signIn("credentials", {
                email,
                password,
                redirect: false,
            });
            if (!result?.ok) {
                setError("Account created. Please sign in.");
                setMode("signin");
                return;
            }

            router.push("/");
            router.refresh();
        } catch {
            setError("Unable to register right now.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 bg-muted/40">
            <Card className="w-full max-w-md shadow-xl border-t-4 border-t-primary">
                <CardHeader className="text-center space-y-2">
                    <div className="flex justify-center mb-2">
                        <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-black text-2xl shadow-lg ring-4 ring-primary/10">
                            K
                        </div>
                    </div>
                    <CardTitle className="text-3xl font-black tracking-tight">
                        Kronos
                    </CardTitle>
                    <CardDescription className="text-base">
                        Your intelligent scheduling assistant
                    </CardDescription>
                </CardHeader>

                <Tabs value={mode} onValueChange={(v) => { setMode(v as Mode); setError(null); }} className="w-full">
                    <CardContent className="space-y-4">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="signin">Sign In</TabsTrigger>
                            <TabsTrigger value="register">Register</TabsTrigger>
                        </TabsList>

                        <form
                            id="login-form"
                            className="space-y-4 pt-2"
                            onSubmit={mode === "signin" ? handleSignIn : handleRegister}
                        >
                            {mode === "register" && (
                                <div className="space-y-2">
                                    <Label htmlFor="name">Name</Label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="name"
                                            className="pl-10"
                                            placeholder="Your name (optional)"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="email"
                                        type="email"
                                        className="pl-10"
                                        placeholder="name@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="password">Password</Label>
                                </div>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="password"
                                        type="password"
                                        className="pl-10"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        minLength={8}
                                        required
                                    />
                                </div>
                            </div>

                            {(error || authError) && (
                                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 shrink-0 opacity-0" /> {/* Spacer */}
                                    {error ?? "Authentication failed. Please try again."}
                                </div>
                            )}
                        </form>
                    </CardContent>

                    <CardFooter>
                        <Button
                            className="w-full h-11 text-base font-bold shadow-lg shadow-primary/20"
                            type="submit"
                            form="login-form"
                            disabled={loading}
                        >
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {loading
                                ? mode === "signin"
                                    ? "Signing in..."
                                    : "Creating account..."
                                : mode === "signin"
                                    ? "Sign In"
                                    : "Create Account"}
                        </Button>
                    </CardFooter>
                </Tabs>
            </Card>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
            <LoginContent />
        </Suspense>
    );
}

