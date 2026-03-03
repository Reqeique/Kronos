"use client"

import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"

interface SiteHeaderProps {
  title: string
  subtitle?: string
  onCreateTask?: () => void
}

export function SiteHeader({ title, subtitle, onCreateTask }: SiteHeaderProps) {
  return (
    <header className="group-has-data-[collapsible=icon]/sidebar-wrapper:h-14 flex h-14 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear">
      <div className="flex w-full items-center gap-2 px-4 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <div className="flex flex-col">
          <h1 className="text-base font-semibold">{title}</h1>
          {subtitle ? (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onCreateTask ? (
            <Button size="sm" onClick={onCreateTask}>
              <PlusIcon className="mr-1 size-4" />
              New Task
            </Button>
          ) : null}
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
