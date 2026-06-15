import { useState, useCallback } from "react";
import { Box, CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dashboard from "./pages/Dashboard";
import ProjectEditor from "./pages/ProjectEditor";
import Settings from "./pages/Settings";
import NovaIntro from "./components/NovaIntro";
import NovaOutOfBoundsGate from "./components/NovaOutOfBoundsGate";
import { darkTheme, lightTheme } from "./theme";
import { useThemeMode } from "./hooks/useThemeMode";

const queryClient = new QueryClient();

type Page = "dashboard" | "editor" | "settings";

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const { mode, toggle } = useThemeMode();

  const theme = mode === "dark" ? darkTheme : lightTheme;

  const onIntroDone = useCallback(() => setIntroDone(true), []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <NovaOutOfBoundsGate themeMode={mode}>
          <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
            {currentPage === "dashboard" && (
              <Dashboard
                onSelectProject={(id) => {
                  setSelectedProject(id);
                  setCurrentPage("editor");
                }}
                onOpenSettings={() => setCurrentPage("settings")}
                themeMode={mode}
                onToggleTheme={toggle}
              />
            )}
            {currentPage === "editor" && (
              <ProjectEditor
                projectId={selectedProject}
                onBack={() => setCurrentPage("dashboard")}
                onOpenSettings={() => setCurrentPage("settings")}
                themeMode={mode}
              />
            )}
            {currentPage === "settings" && (
              <Settings
                onBack={() => setCurrentPage("dashboard")}
                themeMode={mode}
              />
            )}
          </Box>
          {!introDone && <NovaIntro onDone={onIntroDone} />}
        </NovaOutOfBoundsGate>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
