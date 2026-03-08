"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, Loader2Icon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getWorkingDirectorySetting, setWorkingDirectorySetting } from "@/lib/workingDirSetting";

interface Agent {
    id: string;
    name: string;
    alias: string;
}

interface SettingsPageClientProps {
    initialAgents: Agent[];
}

export default function SettingsPageClient({ initialAgents }: SettingsPageClientProps) {
    const [token, setToken] = useState<string | null>(null);
    const [isGeneratingToken, setIsGeneratingToken] = useState(false);
    const [isCreatingAgent, setIsCreatingAgent] = useState(false);
    const [newAgentName, setNewAgentName] = useState("");
    const [newAgentAlias, setNewAgentAlias] = useState("");
    const [copied, setCopied] = useState(false);
    const [agents, setAgents] = useState<Agent[]>(initialAgents);
    const [workingDir, setWorkingDir] = useState("");
    const [isSavingWorkingDir, setIsSavingWorkingDir] = useState(false);

    useEffect(() => {
        setWorkingDir(getWorkingDirectorySetting());
    }, []);

    const generateToken = async () => {
        setIsGeneratingToken(true);
        try {
            const res = await fetch("/api/bridge/token", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                setToken(data.data.token);
                toast.success("Bridge token generated.");
            } else {
                toast.error(data.error?.message || "Failed to generate token");
            }
        } catch {
            toast.error("An error occurred while generating token.");
        } finally {
            setIsGeneratingToken(false);
        }
    };

    const copyToClipboard = () => {
        if (!token) return;
        navigator.clipboard.writeText(token);
        setCopied(true);
        toast.success("Token copied to clipboard.");
        setTimeout(() => setCopied(false), 2000);
    };

    const saveWorkingDir = () => {
        setIsSavingWorkingDir(true);
        setWorkingDirectorySetting(workingDir);
        toast.success(workingDir.trim() ? "Working directory saved." : "Working directory cleared.");
        setTimeout(() => setIsSavingWorkingDir(false), 150);
    };

    const createAgent = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newAgentName || !newAgentAlias) {
            toast.error("Name and alias are required.");
            return;
        }

        setIsCreatingAgent(true);
        try {
            const res = await fetch("/api/agents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: newAgentName,
                    alias: newAgentAlias,
                    agentType: "CUSTOM",
                    connectionTier: "WEBHOOK",
                }),
            });
            const data = await res.json();
            if (data.success) {
                setAgents((prev) => [{ id: data.data.id, name: data.data.name, alias: data.data.alias }, ...prev]);
                setNewAgentName("");
                setNewAgentAlias("");
                toast.success(`Agent @${data.data.alias} created!`);
            } else {
                toast.error(data.error?.message || "Failed to create agent");
            }
        } catch {
            toast.error("An error occurred while creating agent.");
        } finally {
            setIsCreatingAgent(false);
        }
    };

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
                    <p className="text-sm text-muted-foreground">Manage bridge tokens, agent aliases, and editor defaults.</p>
                </div>
                <Button variant="outline" asChild>
                    <Link href="/dashboard">Back to Dashboard</Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Working Directory for @file Suggestions</CardTitle>
                    <CardDescription>
                        This path scopes browser autocomplete in task descriptions. It can be project-relative or any absolute directory.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="space-y-2">
                        <Label htmlFor="working-dir">Directory</Label>
                        <Input
                            id="working-dir"
                            placeholder="e.g. src or C:\\Users\\MYAIAgent\\workspace"
                            value={workingDir}
                            onChange={(event) => setWorkingDir(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">Used by task modal @mention autocomplete. Non-project directories are allowed.</p>
                    </div>
                    <Button onClick={saveWorkingDir} disabled={isSavingWorkingDir}>
                        {isSavingWorkingDir ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save Working Directory
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Bridge Token</CardTitle>
                    <CardDescription>Use this token with the CLI command `kronos login &lt;token&gt;`.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex gap-2">
                        <Input
                            value={token || ""}
                            readOnly
                            placeholder="Click generate to get a token..."
                            className="font-mono text-xs"
                        />
                        {token ? (
                            <Button size="icon" variant="outline" onClick={copyToClipboard}>
                                {copied ? <CheckIcon className="h-4 w-4 text-green-500" /> : <CopyIcon className="h-4 w-4" />}
                            </Button>
                        ) : (
                            <Button size="icon" variant="outline" onClick={generateToken} disabled={isGeneratingToken}>
                                {isGeneratingToken ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <RefreshCwIcon className="h-4 w-4" />}
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Create Agent Alias</CardTitle>
                    <CardDescription>Register aliases used for scheduling and bridge events.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <form onSubmit={createAgent} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="agent-name">Display Name</Label>
                            <Input
                                id="agent-name"
                                placeholder="e.g. My Coding Assistant"
                                value={newAgentName}
                                onChange={(e) => setNewAgentName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="agent-alias">Alias (@handle)</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-2.5 text-muted-foreground">@</span>
                                <Input
                                    id="agent-alias"
                                    className="pl-7"
                                    placeholder="my-agent"
                                    value={newAgentAlias}
                                    onChange={(e) => setNewAgentAlias(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                                />
                            </div>
                        </div>
                        <Button type="submit" className="w-full" disabled={isCreatingAgent}>
                            {isCreatingAgent ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <PlusIcon className="mr-2 h-4 w-4" />}
                            {isCreatingAgent ? "Creating..." : "Create Agent"}
                        </Button>
                    </form>

                    <Separator />

                    <div className="space-y-2">
                        <Label>Existing Agents</Label>
                        {agents.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No agents registered.</p>
                        ) : (
                            <div className="space-y-1">
                                {agents.map((agent) => (
                                    <div key={agent.id} className="rounded border px-3 py-2 text-sm">
                                        <span className="font-semibold">@{agent.alias}</span>
                                        <span className="ml-2 text-muted-foreground">{agent.name}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
