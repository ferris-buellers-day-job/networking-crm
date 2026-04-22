import express from "express";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import healthRouter from "./routes/health.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";
const port = parseInt(process.env.PORT || "3000", 10);
const host = "127.0.0.1";

async function createServer() {
  const app = express();

  // API routes
  app.use("/api", healthRouter);

  if (isProduction) {
    // Production: serve static files from dist/client
    const distPath = resolve(__dirname, "../dist/client");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(resolve(distPath, "index.html"));
    });
  } else {
    // Development: use Vite dev server as middleware
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(port, host, () => {
    console.log(`Server running at http://${host}:${port}`);
  });
}

createServer();
