"use client"

import * as React from "react"
import {
  BotIcon,
  ChartNoAxesCombinedIcon,
  CalendarRangeIcon,
  Link2Icon,
  ListTodoIcon,
  PlusCircleIcon,
} from "lucide-react"

import { NavUser } from "@/components/nav-user"
import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

interface SidebarAgent {
  id: string
  name: string
  alias: string
  lastActiveAt: string | null
}

interface SidebarUser {
  name: string
  email: string
  avatar?: string | null
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  agents: SidebarAgent[]
  user: SidebarUser
  onCreateTask: () => void
  onOpenSettings: () => void
  activeSection: "overview" | "runs" | "calendar"
  onNavigateSection: (section: "overview" | "runs" | "calendar") => void
}

export function AppSidebar({
  agents,
  user,
  onCreateTask,
  onOpenSettings,
  activeSection,
  onNavigateSection,
  ...props
}: AppSidebarProps) {
  const onlineAgents = agents.filter((agent) => agent.lastActiveAt).length

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="h-10" asChild>
              <a href="/dashboard">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  K
                </div>
                <span className="text-base font-semibold">Kronos</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onCreateTask}>
                  <PlusCircleIcon />
                  <span>New Task</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeSection === "overview"}
                  onClick={() => onNavigateSection("overview")}
                >
                  <ChartNoAxesCombinedIcon />
                  <span>Overview</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeSection === "runs"}
                  onClick={() => onNavigateSection("runs")}
                >
                  <ListTodoIcon />
                  <span>Task Runs</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeSection === "calendar"}
                  onClick={() => onNavigateSection("calendar")}
                >
                  <CalendarRangeIcon />
                  <span>Calendar</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/api/slack/install">
                    <Link2Icon />
                    <span>Connect Slack</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>
            Agents
            <Badge variant="outline" className="ml-2 text-[10px]">
              {onlineAgents}/{agents.length} online
            </Badge>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {agents.length === 0 ? (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <BotIcon />
                    <span>No agents registered</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : (
                agents.slice(0, 8).map((agent) => (
                  <SidebarMenuItem key={agent.id}>
                    <SidebarMenuButton>
                      <BotIcon />
                      <span className="flex w-full items-center justify-between">
                        <span>@{agent.alias}</span>
                        <span
                          className={`h-2 w-2 rounded-full ${agent.lastActiveAt ? "bg-status-completed" : "bg-muted"
                            }`}
                        />
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser
          user={{
            name: user.name,
            email: user.email,
            avatar: user.avatar ?? "",
          }}
          onOpenSettings={onOpenSettings}
        />
      </SidebarFooter>
    </Sidebar>
  )
}

