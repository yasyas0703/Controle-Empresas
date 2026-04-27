"use client";

import React, { useState, useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/app/context/ThemeContext";

interface ThemeToggleProps {
  variant?: "sidebar" | "mobile";
}

export default function ThemeToggle({ variant = "sidebar" }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted && theme === "dark";

  const baseClass =
    variant === "mobile"
      ? "p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#2a2f3a] transition-colors"
      : "flex items-center justify-center rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-[#2a2f3a] transition";

  return (
    <button
      aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
      title={isDark ? "Tema claro" : "Tema escuro"}
      onClick={toggleTheme}
      className={baseClass}
    >
      {!mounted ? (
        <span className="w-4 h-4 inline-block" />
      ) : isDark ? (
        <Sun size={16} className="text-yellow-300" />
      ) : (
        <Moon size={16} className="text-sky-600" />
      )}
    </button>
  );
}
