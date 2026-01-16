import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useState } from "react";
import { SignIn } from "./components/SignIn";
import { Dashboard } from "./components/Dashboard";

function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const [isProcessingAuth, setIsProcessingAuth] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("code");
  });
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  // Clean up URL after auth completes or times out
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const url = new URL(window.location.href);
    if (!url.searchParams.has("code")) return;

    // If authenticated, clean up URL immediately
    if (isAuthenticated) {
      url.searchParams.delete("code");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      setIsProcessingAuth(false);
      return;
    }

    // Timeout: if auth doesn't complete in 10 seconds, stop waiting
    const timeout = setTimeout(() => {
      console.warn("Auth timeout - clearing code parameter");
      url.searchParams.delete("code");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      setIsProcessingAuth(false);
    }, 10000);

    return () => clearTimeout(timeout);
  }, [isAuthenticated]);

  // Timeout for stale session: if isLoading stays true for too long, clear auth state
  useEffect(() => {
    if (!isLoading) {
      setLoadingTimedOut(false);
      return;
    }

    const timeout = setTimeout(() => {
      console.warn("Auth loading timeout - clearing stale session");
      signOut().catch(() => {});
      setLoadingTimedOut(true);
    }, 5000);

    return () => clearTimeout(timeout);
  }, [isLoading, signOut]);

  const showLoading = (isLoading && !loadingTimedOut) || isProcessingAuth;

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
