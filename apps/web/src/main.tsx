import "./styles.css";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { registerSW } from "virtual:pwa-register";
import { AppShell } from "./components/AppShell";
import { Spinner } from "./components/ui";
import { api, ApiError, type Me } from "./lib/api";
import { I18nProvider } from "./lib/i18n";
import { WorkspaceProvider } from "./lib/workspace";
import { Home } from "./routes/Home";
import { Login } from "./routes/Login";
import { PageView } from "./routes/PageView";

registerSW({ immediate: true });

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
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace />;
  if (!data) return <div className="p-8 text-sm text-muted-foreground">{String(error)}</div>;
  return (
    <WorkspaceProvider me={data}>
      <AppShell />
    </WorkspaceProvider>
  );
}

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
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

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  </QueryClientProvider>,
);
