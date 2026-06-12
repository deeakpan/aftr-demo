"use client";

import { createContext, useContext } from "react";

export const SidebarOpenContext = createContext(false);

export function useSidebarOpen() {
  return useContext(SidebarOpenContext);
}
