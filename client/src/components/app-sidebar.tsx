import { Calendar, Inbox, BarChart3 } from "lucide-react";
import { useParams } from "react-router-dom";
import { ThemeToggle } from "@/components/theme-toggle";

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";

const items = [
    {
        title: "Chat",
        url: "chat",
        icon: Inbox,
    },
    {
        title: "Character Overview",
        url: "character",
        icon: Calendar,
    },
    {
        title: "AuraLens Dashboard",
        url: "auralens",
        icon: BarChart3,
    },
];

export function AppSidebar() {
    const { agentId } = useParams();

    return (
        <Sidebar>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Application</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {items.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild>
                                        <a href={`/${agentId}/${item.url}`}>
                                            <item.icon />
                                            <span>{item.title}</span>
                                        </a>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <ThemeToggle />
            </SidebarFooter>
        </Sidebar>
    );
}
