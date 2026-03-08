"use client";

import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Check, ChevronsUpDown, Loader2, Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { SchedulingModeIcon } from "@/components/icons";
import { getWorkingDirectorySetting } from "@/lib/workingDirSetting";

interface Agent {
    id: string;
    name: string;
    alias: string;
    agentType: string;
    connectionTier: string;
    lastActiveAt: string | null;
}

interface TaskRun {
    id: string;
    agentId: string;
    taskBody: string;
    status: string;
    schedulingMode: string;
    scheduledAt: string;
    dispatchedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    timeoutMinutes: number;
    slackChannelId: string | null;
    webhookToken: string | null;
    pauseCount: number;
    totalActiveDuration: number;
    totalWaitDuration: number;
    failureReason: string | null;
    latestAgentMessage: string | null;
    completionPath: string | null;
    cronSchedule: string | null;
    agent?: { alias: string; name: string };
}

const formSchema = z.object({
    agentId: z.string().min(1, "Please select an agent"),
    taskBody: z.string().min(1, "Task description is required"),
    scheduledAtDate: z.date(),
    scheduledAtTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time"),
    schedulingMode: z.enum(["AUTONOMOUS", "SUPERVISED", "OBSERVED"]),
    timeoutMinutes: z.coerce.number().min(1).max(1440),
    slackChannelId: z.string().optional(),
    cronMode: z.string().optional(),
    customCron: z.string().optional(),
});

type FormValues = z.output<typeof formSchema>;
type FormInput = z.input<typeof formSchema>;

interface CreateTaskModalProps {
    agents: Agent[];
    defaultStart?: Date;
    onClose: () => void;
    onCreated: (taskRun: TaskRun) => void;
}

const MODE_INFO = {
    AUTONOMOUS: {
        label: "Autonomous",
        desc: "Sandboxed, no interrupts",
        color: "text-green-500",
    },
    SUPERVISED: {
        label: "Supervised",
        desc: "Human-in-the-loop, can pause",
        color: "text-yellow-500",
    },
    OBSERVED: {
        label: "Observed",
        desc: "Terminal agent via kronos watch",
        color: "text-gray-500",
    },
};

export default function CreateTaskModal({
    agents,
    defaultStart,
    onClose,
    onCreated,
}: CreateTaskModalProps) {
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false); // For the agent combo-box
    const [mentionOpen, setMentionOpen] = useState(false);
    const [mentionSuggestions, setMentionSuggestions] = useState<string[]>([]);
    const [mentionQuery, setMentionQuery] = useState<string>("");
    const [mentionCursorStart, setMentionCursorStart] = useState<number | null>(null);
    const [mentionHighlight, setMentionHighlight] = useState(0);
    const [workingDir, setWorkingDir] = useState("");
    const taskTextareaRef = useRef<HTMLTextAreaElement | null>(null);

    const initialDate = defaultStart || new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const initialTime = `${pad(initialDate.getHours())}:${pad(initialDate.getMinutes())}`;

    const form = useForm<FormInput, undefined, FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            agentId: agents[0]?.id ?? "",
            taskBody: "",
            scheduledAtDate: initialDate,
            scheduledAtTime: initialTime,
            schedulingMode: "AUTONOMOUS",
            timeoutMinutes: 60,
            slackChannelId: "",
            cronMode: "none",
            customCron: "",
        },
    });

    async function onSubmit(values: FormValues) {
        setLoading(true);
        try {
            const [hours, minutes] = values.scheduledAtTime.split(":").map(Number);
            const scheduledAt = new Date(values.scheduledAtDate);
            scheduledAt.setHours(hours, minutes, 0, 0);

            let cronSchedule: string | undefined = undefined;
            if (values.cronMode === "daily") cronSchedule = `${minutes} ${hours} * * *`;
            else if (values.cronMode === "weekly") cronSchedule = `${minutes} ${hours} * * ${scheduledAt.getDay()}`;
            else if (values.cronMode === "custom" && values.customCron?.trim()) cronSchedule = values.customCron.trim();

            const res = await fetch("/api/task-runs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    agentId: values.agentId,
                    taskBody: values.taskBody,
                    schedulingMode: values.schedulingMode,
                    slackChannelId: values.slackChannelId,
                    scheduledAt: scheduledAt.toISOString(),
                    timeoutMinutes: Number(values.timeoutMinutes),
                    cronSchedule,
                }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error?.message ?? "Failed to create task");
            onCreated(data.data);
            onClose();
        } catch (err) {
            form.setError("root", {
                message: err instanceof Error ? err.message : "Unknown error",
            });
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        setWorkingDir(getWorkingDirectorySetting());
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        const handle = setTimeout(async () => {
            if (!mentionOpen) return;
            try {
                const params = new URLSearchParams({ q: mentionQuery });
                if (workingDir.trim()) params.set("cwd", workingDir.trim());
                const res = await fetch(`/api/files/suggest?${params.toString()}`, {
                    signal: controller.signal,
                });
                const data = await res.json();
                const suggestions = Array.isArray(data?.data?.suggestions) ? data.data.suggestions : [];
                setMentionSuggestions(suggestions);
                setMentionHighlight(0);
            } catch {
                setMentionSuggestions([]);
            }
        }, 80);

        return () => {
            clearTimeout(handle);
            controller.abort();
        };
    }, [mentionOpen, mentionQuery, workingDir]);

    const extractMentionAtCursor = (value: string, cursor: number | null) => {
        if (cursor == null || cursor < 0) return null;
        const left = value.slice(0, cursor);
        const match = left.match(/(?:^|\s)@([^\s@]*)$/);
        if (!match) return null;

        const query = match[1] ?? "";
        const tokenStart = cursor - query.length;
        return { query, tokenStart };
    };

    const applyMentionSuggestion = (suggestion: string, fieldValue: string, cursor: number | null) => {
        if (mentionCursorStart == null || cursor == null) return;
        const nextValue = `${fieldValue.slice(0, mentionCursorStart)}${suggestion}${fieldValue.slice(cursor)}`;
        form.setValue("taskBody", nextValue, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
        setMentionOpen(false);
        setMentionSuggestions([]);
        setMentionQuery("");
        requestAnimationFrame(() => {
            const nextCursor = mentionCursorStart + suggestion.length;
            const el = taskTextareaRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(nextCursor, nextCursor);
        });
    };

    return (
        <Dialog open onOpenChange={(val) => !val && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>New Task</DialogTitle>
                    <DialogDescription>
                        Assign a task to an agent and schedule it.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="agentId"
                            render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Agent</FormLabel>
                                    <Popover open={open} onOpenChange={setOpen}>
                                        <PopoverTrigger asChild>
                                            <FormControl>
                                                <Button
                                                    variant="outline"
                                                    role="combobox"
                                                    aria-expanded={open}
                                                    className={cn(
                                                        "w-full justify-between font-normal",
                                                        !field.value && "text-muted-foreground"
                                                    )}
                                                >
                                                    {field.value
                                                        ? `@${agents.find((a) => a.id === field.value)?.alias}`
                                                        : "Select agent..."}
                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[400px] p-0" align="start">
                                            <Command>
                                                <CommandInput placeholder="Search agent alias..." />
                                                <CommandList>
                                                    <CommandEmpty>No agent found.</CommandEmpty>
                                                    <CommandGroup>
                                                        {agents.map((agent) => (
                                                            <CommandItem
                                                                key={agent.id}
                                                                value={agent.alias}
                                                                onSelect={() => {
                                                                    form.setValue("agentId", agent.id);
                                                                    setOpen(false);
                                                                }}
                                                            >
                                                                <Check
                                                                    className={cn(
                                                                        "mr-2 h-4 w-4",
                                                                        field.value === agent.id ? "opacity-100" : "opacity-0"
                                                                    )}
                                                                />
                                                                <div className="flex items-center gap-2">
                                                                    <span className={cn(
                                                                        "h-2 w-2 rounded-full",
                                                                        agent.lastActiveAt ? "bg-status-completed" : "bg-muted"
                                                                    )} />
                                                                    <span className="font-bold">@{agent.alias}</span>
                                                                    <span className="text-muted-foreground text-xs">{agent.name}</span>
                                                                </div>
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="taskBody"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Task Description</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder="Describe the task for the agent..."
                                            className="min-h-[100px] resize-none"
                                            {...field}
                                            ref={(el) => {
                                                field.ref(el);
                                                taskTextareaRef.current = el;
                                            }}
                                            onChange={(event) => {
                                                field.onChange(event);
                                                const value = event.target.value;
                                                const cursor = event.target.selectionStart;
                                                const mention = extractMentionAtCursor(value, cursor);
                                                if (!mention) {
                                                    setMentionOpen(false);
                                                    return;
                                                }
                                                setMentionCursorStart(mention.tokenStart);
                                                setMentionQuery(mention.query);
                                                setMentionOpen(true);
                                            }}
                                            onBlur={(event) => {
                                                field.onBlur();
                                                const nextTarget = event.relatedTarget as HTMLElement | null;
                                                if (nextTarget?.dataset?.mentionItem === "true") return;
                                                setMentionOpen(false);
                                            }}
                                            onKeyDown={(event) => {
                                                if (!mentionOpen || mentionSuggestions.length === 0) return;
                                                if (event.key === "ArrowDown") {
                                                    event.preventDefault();
                                                    setMentionHighlight((prev) => (prev + 1) % mentionSuggestions.length);
                                                    return;
                                                }
                                                if (event.key === "ArrowUp") {
                                                    event.preventDefault();
                                                    setMentionHighlight((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                                                    return;
                                                }
                                                if (event.key === "Escape") {
                                                    event.preventDefault();
                                                    setMentionOpen(false);
                                                    return;
                                                }
                                                if (event.key === "Enter" || event.key === "Tab") {
                                                    event.preventDefault();
                                                    applyMentionSuggestion(
                                                        mentionSuggestions[mentionHighlight],
                                                        field.value,
                                                        event.currentTarget.selectionStart,
                                                    );
                                                }
                                            }}
                                        />
                                    </FormControl>
                                    {mentionOpen && mentionSuggestions.length > 0 && (
                                        <div className="mt-2 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                                            {mentionSuggestions.map((suggestion, index) => (
                                                <button
                                                    key={suggestion}
                                                    type="button"
                                                    data-mention-item="true"
                                                    className={cn(
                                                        "block w-full rounded-sm px-2 py-1 text-left text-sm",
                                                        index === mentionHighlight ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                                                    )}
                                                    onMouseEnter={() => setMentionHighlight(index)}
                                                    onMouseDown={(event) => {
                                                        event.preventDefault();
                                                        applyMentionSuggestion(
                                                            suggestion,
                                                            field.value,
                                                            taskTextareaRef.current?.selectionStart ?? null,
                                                        );
                                                    }}
                                                >
                                                    @{suggestion}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="scheduledAtDate"
                                render={({ field }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>Date</FormLabel>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <FormControl>
                                                    <Button
                                                        variant={"outline"}
                                                        className={cn(
                                                            "w-full pl-3 text-left font-normal",
                                                            !field.value && "text-muted-foreground"
                                                        )}
                                                    >
                                                        {field.value ? (
                                                            format(field.value, "PPP")
                                                        ) : (
                                                            <span>Pick a date</span>
                                                        )}
                                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                    </Button>
                                                </FormControl>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar
                                                    mode="single"
                                                    selected={field.value}
                                                    onSelect={field.onChange}
                                                    disabled={(date) =>
                                                        date < new Date(new Date().setHours(0, 0, 0, 0))
                                                    }
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="scheduledAtTime"
                                render={({ field }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>Time</FormLabel>
                                        <FormControl>
                                            <Input type="time" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="cronMode"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Repeat</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Does not repeat" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="none">Does not repeat</SelectItem>
                                                <SelectItem value="daily">Daily</SelectItem>
                                                <SelectItem value="weekly">Weekly</SelectItem>
                                                <SelectItem value="custom">Custom Cron</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            {form.watch("cronMode") === "custom" ? (
                                <FormField
                                    control={form.control}
                                    name="customCron"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Cron Expression</FormLabel>
                                            <FormControl>
                                                <Input placeholder="e.g. 0 12 * * *" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            ) : <div />}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="schedulingMode"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Scheduling Mode</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select mode" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {Object.entries(MODE_INFO).map(([mode, info]) => (
                                                    <SelectItem key={mode} value={mode}>
                                                        <div className="flex items-center gap-2">
                                                            <SchedulingModeIcon mode={mode} className="h-4 w-4" />
                                                            <div>
                                                                <div className="font-medium">{info.label}</div>
                                                                <div className="text-xs text-muted-foreground">{info.desc}</div>
                                                            </div>
                                                        </div>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="timeoutMinutes"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Timeout (min)</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                name={field.name}
                                                ref={field.ref}
                                                onBlur={field.onBlur}
                                                value={typeof field.value === "number" ? field.value : ""}
                                                onChange={(event) => field.onChange(event.target.valueAsNumber)}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="slackChannelId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Slack Channel ID (optional)</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. C01234ABCDE" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {form.formState.errors.root && (
                            <div className="text-sm font-medium text-destructive">
                                {form.formState.errors.root.message}
                            </div>
                        )}

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {loading ? "Scheduling..." : "Schedule Task"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
