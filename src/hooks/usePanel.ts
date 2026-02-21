"use client";

import { createContext, useContext } from "react";
import type { PermissionRequestEvent } from "@/types";

export type PanelContent = "files" | "tasks";

export type PreviewViewMode = "source" | "rendered";

export interface PanelContextValue {
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  panelContent: PanelContent;
  setPanelContent: (content: PanelContent) => void;
  workingDirectory: string;
  setWorkingDirectory: (dir: string) => void;
  sessionId: string;
  setSessionId: (id: string) => void;
  sessionTitle: string;
  setSessionTitle: (title: string) => void;
  streamingSessionId: string;
  setStreamingSessionId: (id: string) => void;
  pendingApprovalSessionId: string;
  setPendingApprovalSessionId: (id: string) => void;
  pendingApprovalData: PermissionRequestEvent | null;
  setPendingApprovalData: (data: PermissionRequestEvent | null) => void;
  previewFile: string | null;
  setPreviewFile: (path: string | null) => void;
  previewViewMode: PreviewViewMode;
  setPreviewViewMode: (mode: PreviewViewMode) => void;
  isMobile: boolean;
  completedSessionIds: Set<string>;
  addCompletedSession: (id: string) => void;
  removeCompletedSession: (id: string) => void;
}

export const PanelContext = createContext<PanelContextValue | null>(null);

export function usePanel(): PanelContextValue {
  const ctx = useContext(PanelContext);
  if (!ctx) {
    throw new Error("usePanel must be used within a PanelProvider");
  }
  return ctx;
}
