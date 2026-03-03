"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"

export interface TaskVolumePoint {
  date: string
  scheduled: number
  completed: number
}

const chartConfig = {
  scheduled: {
    label: "Scheduled",
    color: "var(--chart-1)",
  },
  completed: {
    label: "Completed",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

export function ChartAreaInteractive({ data }: { data: TaskVolumePoint[] }) {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("30d")

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("7d")
    }
  }, [isMobile])

  const filteredData = React.useMemo(() => {
    if (!data.length) return []

    const sorted = [...data].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    )

    const referenceDate = new Date(sorted[sorted.length - 1].date)
    let daysToSubtract = 90

    if (timeRange === "30d") {
      daysToSubtract = 30
    } else if (timeRange === "7d") {
      daysToSubtract = 7
    }

    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)

    return sorted.filter((item) => new Date(item.date) >= startDate)
  }, [data, timeRange])

  const totals = React.useMemo(() => {
    return filteredData.reduce(
      (acc, item) => {
        acc.scheduled += item.scheduled
        acc.completed += item.completed
        return acc
      },
      { scheduled: 0, completed: 0 }
    )
  }, [filteredData])

  return (
    <Card className="@container/card">
      <CardHeader className="relative">
        <CardTitle>Task Volume</CardTitle>
        <CardDescription>
          <span className="@[540px]/card:block hidden">
            Scheduled vs completed tasks ({totals.scheduled} / {totals.completed})
          </span>
          <span className="@[540px]/card:hidden">Task volume</span>
        </CardDescription>
        <div className="absolute right-4 top-4">
          <ToggleGroup
            type="single"
            value={timeRange}
            onValueChange={(next) => next && setTimeRange(next)}
            variant="outline"
            className="@[767px]/card:flex hidden"
          >
            <ToggleGroupItem value="90d" className="h-8 px-2.5">
              Last 3 months
            </ToggleGroupItem>
            <ToggleGroupItem value="30d" className="h-8 px-2.5">
              Last 30 days
            </ToggleGroupItem>
            <ToggleGroupItem value="7d" className="h-8 px-2.5">
              Last 7 days
            </ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger
              className="@[767px]/card:hidden flex w-40"
              aria-label="Select a value"
            >
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">
                Last 3 months
              </SelectItem>
              <SelectItem value="30d" className="rounded-lg">
                Last 30 days
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                Last 7 days
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {filteredData.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No task activity in this range.
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <AreaChart data={filteredData}>
              <defs>
                <linearGradient id="fillScheduled" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-scheduled)" stopOpacity={0.9} />
                  <stop
                    offset="95%"
                    stopColor="var(--color-scheduled)"
                    stopOpacity={0.12}
                  />
                </linearGradient>
                <linearGradient id="fillCompleted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-completed)" stopOpacity={0.85} />
                  <stop
                    offset="95%"
                    stopColor="var(--color-completed)"
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => {
                  const date = new Date(value)
                  return date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                }}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => {
                      return new Date(value).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    }}
                    indicator="dot"
                  />
                }
              />
              <Area
                dataKey="scheduled"
                type="monotone"
                fill="url(#fillScheduled)"
                stroke="var(--color-scheduled)"
                strokeWidth={2}
              />
              <Area
                dataKey="completed"
                type="monotone"
                fill="url(#fillCompleted)"
                stroke="var(--color-completed)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
