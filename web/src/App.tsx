import { useConvexAuth } from "convex/react";
import { useEffect, useMemo } from "react";
import { SignIn } from "./components/SignIn";
import { Dashboard } from "./components/Dashboard";

function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const hasAuthCode = useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return new URLSearchParams(window.location.search).has("code");
  }, []);

  useEffect(() => {
    if (!isAuthenticated || typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    if (!url.searchParams.has("code")) {
      return;
    }
    url.searchParams.delete("code");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [isAuthenticated]);

  const showLoading = isLoading || (hasAuthCode && !isAuthenticated);

  return (
    <div className="app">
      {showLoading ? <LoadingScreen /> : null}
      {!showLoading && isAuthenticated ? <Dashboard /> : null}
      {!showLoading && !isAuthenticated ? <SignIn /> : null}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="logo">
          CEL<span className="accent">.</span>STATE
        </div>
        <div className="loading-spinner" />
      </div>
    </div>
  );
}

export default App;
