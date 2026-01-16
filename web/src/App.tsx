import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { SignIn } from "./components/SignIn";
import { Dashboard } from "./components/Dashboard";

function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [isProcessingAuth, setIsProcessingAuth] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("code");
  });

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

  const showLoading = isLoading || isProcessingAuth;

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
