import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Expose to all network interfaces
    proxy: {
      "/socket.io": {
        target: "http://localhost:3001", // Change this to your backend server URL in development
        ws: true, // Enable WebSocket proxying
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false, // Set to true if you want source maps in production
    minify: "terser", // Use terser for better minification
    terserOptions: {
      compress: {
        drop_console: false, // Keep console.logs for debugging
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "socket-vendor": ["socket.io-client"],
        },
      },
    },
  },
  define: {
    // Polyfill for Node.js globals
    global: "globalThis",
    "process.env": {},
    // Add any global constants here if needed
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
  resolve: {
    alias: {
      // Polyfill for Node.js modules
      stream: "stream-browserify",
      crypto: "crypto-browserify",
      buffer: "buffer",
      util: "util",
      // Add any path aliases here if needed
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      // Node.js global to browser globalThis
      define: {
        global: "globalThis",
      },
    },
  },
});
