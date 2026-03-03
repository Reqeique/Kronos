type IconProps = {
    className?: string;
};

const iconProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
};

export function CalendarIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <line x1="8" y1="2.5" x2="8" y2="6.5" />
            <line x1="16" y1="2.5" x2="16" y2="6.5" />
            <line x1="3" y1="9" x2="21" y2="9" />
        </svg>
    );
}

export function ChartIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <line x1="4" y1="20" x2="20" y2="20" />
            <rect x="5" y="11" width="3.5" height="7" rx="1" />
            <rect x="10.25" y="8" width="3.5" height="10" rx="1" />
            <rect x="15.5" y="5" width="3.5" height="13" rx="1" />
        </svg>
    );
}

export function GearIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <circle cx="12" cy="12" r="3.25" />
            <path d="M19 12a7.07 7.07 0 0 0-.1-1.15l2-1.55-1.8-3.12-2.45.7a7.46 7.46 0 0 0-2-1.17L14.2 3h-3.6l-.45 2.7a7.46 7.46 0 0 0-2 1.17l-2.45-.7L3.9 9.3l2 1.55A7.07 7.07 0 0 0 5.8 12c0 .4.03.78.1 1.15l-2 1.55 1.8 3.12 2.45-.7c.6.5 1.28.9 2 1.17l.45 2.7h3.6l.45-2.7a7.46 7.46 0 0 0 2-1.17l2.45.7 1.8-3.12-2-1.55c.07-.37.1-.75.1-1.15Z" />
        </svg>
    );
}

export function PlusIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    );
}

export function LinkIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <path d="M10.4 13.6 8 16a3 3 0 1 1-4.2-4.2l3.1-3.1A3 3 0 0 1 11 8" />
            <path d="m13.6 10.4 2.4-2.4a3 3 0 1 1 4.2 4.2l-3.1 3.1A3 3 0 0 1 13 16" />
            <line x1="9.5" y1="14.5" x2="14.5" y2="9.5" />
        </svg>
    );
}

export function CloseIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
    );
}

export function CheckIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <polyline points="5 13 10 18 19 7" />
        </svg>
    );
}

export function ShieldIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <path d="M12 3 5 6v6c0 4.4 2.7 7.7 7 9 4.3-1.3 7-4.6 7-9V6l-7-3Z" />
        </svg>
    );
}

export function EyeIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
            <circle cx="12" cy="12" r="2.5" />
        </svg>
    );
}

export function MonitorIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <rect x="3" y="4" width="18" height="13" rx="2" />
            <line x1="8" y1="20" x2="16" y2="20" />
            <line x1="12" y1="17" x2="12" y2="20" />
        </svg>
    );
}

export function SendIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <path d="M3 12 21 4l-6 16-3.5-6.5L3 12Z" />
            <line x1="11.5" y1="13.5" x2="21" y2="4" />
        </svg>
    );
}

export function BoltIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <polyline points="13 2 6 13 12 13 11 22 18 10 12 10 13 2" />
        </svg>
    );
}

export function ClockIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15.5 14.5" />
        </svg>
    );
}

export function AlertClockIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <circle cx="12" cy="13" r="8" />
            <polyline points="12 9.5 12 13 14.8 15" />
            <line x1="6" y1="4" x2="8" y2="6" />
            <line x1="18" y1="4" x2="16" y2="6" />
        </svg>
    );
}

export function CheckCircleIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <circle cx="12" cy="12" r="9" />
            <polyline points="8 12 11 15 16 9" />
        </svg>
    );
}

export function XCircleIcon({ className }: IconProps) {
    return (
        <svg {...iconProps} className={className}>
            <circle cx="12" cy="12" r="9" />
            <line x1="9" y1="9" x2="15" y2="15" />
            <line x1="15" y1="9" x2="9" y2="15" />
        </svg>
    );
}

export function SchedulingModeIcon({
    mode,
    className,
}: {
    mode: string;
    className?: string;
}) {
    if (mode === "AUTONOMOUS") return <ShieldIcon className={className} />;
    if (mode === "SUPERVISED") return <EyeIcon className={className} />;
    return <MonitorIcon className={className} />;
}

export function TaskStatusIcon({
    status,
    className,
}: {
    status: string;
    className?: string;
}) {
    if (status === "SCHEDULED") return <CalendarIcon className={className} />;
    if (status === "DISPATCHED") return <SendIcon className={className} />;
    if (status === "IN_PROGRESS") return <BoltIcon className={className} />;
    if (status === "WAITING") return <ClockIcon className={className} />;
    if (status === "COMPLETED") return <CheckCircleIcon className={className} />;
    if (status === "FAILED") return <XCircleIcon className={className} />;
    return <AlertClockIcon className={className} />;
}
