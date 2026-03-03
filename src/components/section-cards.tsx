import { ActivityIcon, BotIcon, CheckCircle2Icon, TimerIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface SectionCardsProps {
  stats: {
    active: number
    completedToday: number
    agentsOnline: number
    avgDuration: string | null
  }
}

export function SectionCards({ stats }: SectionCardsProps) {
  return (
    <div className="*:data-[slot=card]:shadow-xs grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card lg:px-6">
      <Card className="@container/card">
        <CardHeader className="relative">
          <CardDescription>Active Tasks</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            {stats.active}
          </CardTitle>
          <div className="absolute right-4 top-4">
            <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
              <ActivityIcon className="size-3" />
              Live
            </Badge>
          </div>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Running right now <ActivityIcon className="size-4" />
          </div>
          <div className="text-muted-foreground">SSE synced status updates</div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader className="relative">
          <CardDescription>Completed Today</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            {stats.completedToday}
          </CardTitle>
          <div className="absolute right-4 top-4">
            <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
              <CheckCircle2Icon className="size-3" />
              Done
            </Badge>
          </div>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Finished in the last 24h <CheckCircle2Icon className="size-4" />
          </div>
          <div className="text-muted-foreground">Completion path tracked</div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader className="relative">
          <CardDescription>Agents Online</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            {stats.agentsOnline}
          </CardTitle>
          <div className="absolute right-4 top-4">
            <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
              <BotIcon className="size-3" />
              Agents
            </Badge>
          </div>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Available for scheduling <BotIcon className="size-4" />
          </div>
          <div className="text-muted-foreground">Based on last active signal</div>
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader className="relative">
          <CardDescription>Avg Duration</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            {stats.avgDuration ?? "-"}
          </CardTitle>
          <div className="absolute right-4 top-4">
            <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
              <TimerIcon className="size-3" />
              Runtime
            </Badge>
          </div>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Completed task average <TimerIcon className="size-4" />
          </div>
          <div className="text-muted-foreground">Based on started to completed</div>
        </CardFooter>
      </Card>
    </div>
  )
}
