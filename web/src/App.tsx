import { useConvexAuth } from "convex/react";
import { useEffect, useState, useRef } from "react";
import { SignIn } from "./components/SignIn";
import { Dashboard } from "./components/Dashboard";

function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const hasCode = useRef(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("code")
  );

  // Debug logging
  useEffect(() => {
    console.log("[Auth Debug]", {
      isAuthenticated,
      isLoading,
      authTimedOut,
      hasCode: hasCode.current,
      url: window.location.href,
    });
  }, [isAuthenticated, isLoading, authTimedOut]);

  // Handle auth completion or timeout
  useEffect(() => {
    // If authenticated, clean up URL
    if (isAuthenticated && hasCode.current) {
      console.log("[Auth Debug] Authenticated, cleaning URL");
      const url = new URL(window.location.href);
      url.searchParams.delete("code");
      window.history.replaceState({}, "", url.pathname + url.search);
      hasCode.current = false;
      return;
    }

    // If we have a code and auth is still loading, set a timeout
    if (hasCode.current && isLoading) {
      const timeout = setTimeout(() => {
        console.warn("[Auth Debug] Auth timeout after 8s");
        // Clean up URL and show sign-in
        const url = new URL(window.location.href);
        url.searchParams.delete("code");
        window.history.replaceState({}, "", url.pathname + url.search);
        hasCode.current = false;
        setAuthTimedOut(true);
      }, 8000);

      return () => clearTimeout(timeout);
    }

    // Reset timeout flag when loading finishes
    if (!isLoading && authTimedOut) {
      setAuthTimedOut(false);
    }
  }, [isAuthenticated, isLoading, authTimedOut]);

  // Show loading only during initial load or OAuth processing
  const showLoading = isLoading && !authTimedOut;

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
