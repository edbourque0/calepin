import "./styles.css";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { AppShell } from "./components/AppShell";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { Spinner } from "./components/ui";
import { api, ApiError, type Me } from "./lib/api";
import { I18nProvider } from "./lib/i18n";
import { checkEpoch, WorkspaceProvider } from "./lib/workspace";
import { Home } from "./routes/Home";
import { Invite } from "./routes/Invite";
import { Login } from "./routes/Login";
import { PageView } from "./routes/PageView";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

function AuthGate() {
  const { data, error, isLoading } = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/me") });
  if (isLoading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  if (error instanceof ApiError && error.status === 401) {
    const here = window.location.pathname + window.location.search;
    return <Navigate to={here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`} replace />;
  }
  if (!data) return <div className="p-8 text-sm text-muted-foreground">{String(error)}</div>;
  return (
    <WorkspaceProvider me={data}>
      <AppShell />
    </WorkspaceProvider>
  );
}

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/invite/:token", element: <Invite /> },
  {
    path: "/",
    element: <AuthGate />,
    children: [
      { index: true, element: <Home /> },
      { path: "p/:pageId", element: <PageView /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

await checkEpoch();

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <RouterProvider router={router} />
      <UpdatePrompt />
    </I18nProvider>
  </QueryClientProvider>,
);
