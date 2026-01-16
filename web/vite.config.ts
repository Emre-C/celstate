import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const isProduction = command === "build" || mode === "production";

  return {
    plugins: [react()],
    base: isProduction ? "/app/" : "/",
    build: {
      outDir: "../dist/app",
      emptyOutDir: true,
    },
  };
});
