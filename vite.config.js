import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import terminal from "vite-plugin-terminal";

export default defineConfig({
  plugins: [
    react(),
    terminal({ output: ["terminal", "console"] }),
  ],
});
