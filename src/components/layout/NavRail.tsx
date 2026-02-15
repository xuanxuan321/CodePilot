"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Message02Icon,
  GridIcon,
  Settings02Icon,
  Moon02Icon,
  Sun02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";


interface NavRailProps {
  chatListOpen: boolean;
  onToggleChatList: () => void;
  hasUpdate?: boolean;
  skipPermissionsActive?: boolean;
  isMobile?: boolean;
  onToggleMobileChatList?: () => void;
}

const navItems = [
  { href: "/chat", label: "Chats", icon: Message02Icon },
  { href: "/extensions", label: "Extensions", icon: GridIcon },
  { href: "/settings", label: "Settings", icon: Settings02Icon },
] as const;

export function NavRail({ onToggleChatList, hasUpdate, skipPermissionsActive, isMobile, onToggleMobileChatList }: NavRailProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const emptySubscribe = useCallback(() => () => {}, []);
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const isChatRoute = pathname === "/chat" || pathname.startsWith("/chat/");

  const tooltipSide = isMobile ? "top" : "right";

  return (
    <aside className={cn(
      "flex items-center bg-sidebar",
      // Mobile: fixed bottom horizontal bar
      "fixed bottom-0 left-0 right-0 z-50 h-14 flex-row justify-around border-t border-border/50",
      // Desktop: left sidebar
      "md:relative md:w-14 md:shrink-0 md:flex-col md:h-auto md:pb-3 md:pt-10 md:border-t-0"
    )}>
      {/* Nav icons */}
      <nav className="flex flex-row md:flex-1 md:flex-col items-center gap-1 justify-around md:justify-start w-full md:w-auto">
        {navItems.map((item) => {
          const isActive =
            item.href === "/chat"
              ? pathname === "/chat" || pathname.startsWith("/chat/")
              : item.href === "/extensions"
                ? pathname.startsWith("/extensions")
                : pathname === item.href || pathname.startsWith(item.href + "?");

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                {item.href === "/chat" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-11 w-11 md:h-9 md:w-9",
                      isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                    )}
                    onClick={() => {
                      if (isMobile) {
                        if (!isChatRoute) {
                          router.push("/chat");
                        }
                        onToggleMobileChatList?.();
                      } else {
                        if (!isChatRoute) {
                          router.push("/chat");
                          onToggleChatList();
                        } else {
                          onToggleChatList();
                        }
                      }
                    }}
                  >
                    <HugeiconsIcon icon={item.icon} className="h-5 w-5 md:h-4 md:w-4" />
                    <span className="sr-only">{item.label}</span>
                  </Button>
                ) : (
                  <div className="relative">
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-11 w-11 md:h-9 md:w-9",
                        isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                      )}
                    >
                      <Link href={item.href}>
                        <HugeiconsIcon icon={item.icon} className="h-5 w-5 md:h-4 md:w-4" />
                        <span className="sr-only">{item.label}</span>
                      </Link>
                    </Button>
                    {item.href === "/settings" && hasUpdate && (
                      <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-blue-500" />
                    )}
                  </div>
                )}
              </TooltipTrigger>
              <TooltipContent side={tooltipSide}>{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Bottom: skip-permissions indicator + theme toggle (desktop only) */}
      <div className="mt-auto hidden md:flex flex-col items-center gap-2">
        {skipPermissionsActive && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex h-8 w-8 items-center justify-center">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-orange-500" />
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">Auto-approve is ON</TooltipContent>
          </Tooltip>
        )}
        {mounted && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="h-8 w-8"
              >
                {theme === "dark" ? (
                  <HugeiconsIcon icon={Sun02Icon} className="h-4 w-4" />
                ) : (
                  <HugeiconsIcon icon={Moon02Icon} className="h-4 w-4" />
                )}
                <span className="sr-only">Toggle theme</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}
