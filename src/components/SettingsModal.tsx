"use client"

import { useState } from "react"
import { CopyIcon, Loader2Icon, PlusIcon, RefreshCwIcon, CheckIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

interface Agent {
    id: string
    name: string
    alias: string
    agentType: string
    connectionTier: string
    lastActiveAt: string | null
}

interface SettingsModalProps {
    isOpen: boolean
    onClose: () => void
    onAgentCreated: (agent: Agent) => void
}

export default function SettingsModal({ isOpen, onClose, onAgentCreated }: SettingsModalProps) {
    const [token, setToken] = useState<string | null>(null)
    const [isGeneratingToken, setIsGeneratingToken] = useState(false)
    const [isCreatingAgent, setIsCreatingAgent] = useState(false)
    const [newAgentName, setNewAgentName] = useState("")
    const [newAgentAlias, setNewAgentAlias] = useState("")
    const [copied, setCopied] = useState(false)

    const generateToken = async () => {
        setIsGeneratingToken(true)
        try {
            const res = await fetch("/api/bridge/token", { method: "POST" })
            const data = await res.json()
            if (data.success) {
                setToken(data.data.token)
                toast.success("Bridge token generated.")
            } else {
                toast.error(data.error?.message || "Failed to generate token")
            }
        } catch (error) {
            toast.error("An error occurred while generating token.")
        } finally {
            setIsGeneratingToken(false)
        }
    }

    const copyToClipboard = () => {
        if (token) {
            navigator.clipboard.writeText(token)
            setCopied(true)
            toast.success("Token copied to clipboard.")
            setTimeout(() => setCopied(false), 2000)
        }
    }

    const createAgent = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newAgentName || !newAgentAlias) {
            toast.error("Name and alias are required.")
            return
        }

        setIsCreatingAgent(true)
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
            })
            const data = await res.json()
            if (data.success) {
                onAgentCreated(data.data)
                setNewAgentName("")
                setNewAgentAlias("")
                toast.success(`Agent @${data.data.alias} created!`)
            } else {
                toast.error(data.error?.message || "Failed to create agent")
            }
        } catch (error) {
            toast.error("An error occurred while creating agent.")
        } finally {
            setIsCreatingAgent(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(val) => !val && onClose()}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Manage your bridge tokens and agent aliases.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            Bridge Token
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            Use this token with the CLI: <code className="bg-muted px-1 rounded">kronos login [token]</code>
                        </p>
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
                                    {isGeneratingToken ? (
                                        <Loader2Icon className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <RefreshCwIcon className="h-4 w-4" />
                                    )}
                                </Button>
                            )}
                        </div>
                    </div>

                    <Separator />

                    <form onSubmit={createAgent} className="space-y-4">
                        <Label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            Create Agent Alias
                        </Label>
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
                            <p className="text-[10px] text-muted-foreground">
                                Lowercase letters, numbers, and hyphens only.
                            </p>
                        </div>
                        <Button type="submit" className="w-full" disabled={isCreatingAgent}>
                            {isCreatingAgent ? (
                                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <PlusIcon className="mr-2 h-4 w-4" />
                            )}
                            {isCreatingAgent ? "Creating..." : "Create Agent"}
                        </Button>
                    </form>
                </div>
            </DialogContent>
        </Dialog>
    )
}
