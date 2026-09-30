import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider, RequireAuth } from "@/lib/auth";
import { LoginPage } from "@/pages/login";
import { AskPage } from "@/pages/ask";
import { LibraryPage } from "@/pages/library";
import { DashboardPage } from "@/pages/dashboard";
import { DocumentPage } from "@/pages/document";
import { UploadPage } from "@/pages/upload";
import { IssuesPage } from "@/pages/issues";
import { GraphPage } from "@/pages/graph";

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={150}>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                element={
                  <RequireAuth>
                    <AppShell />
                  </RequireAuth>
                }
              >
                <Route index element={<AskPage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/documents/:id" element={<DocumentPage />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="/issues" element={<IssuesPage />} />
                <Route path="/graph" element={<GraphPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </AuthProvider>
        </BrowserRouter>
        <Toaster
          position="bottom-right"
          theme="system"
          toastOptions={{
            classNames: {
              toast: "bg-card text-card-foreground border border-border",
            },
          }}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}
