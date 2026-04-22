import { useEffect, useState } from "react";

interface HealthResponse {
  ok: boolean;
  version: string;
  commit: string;
}

export function App() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [debug, setDebug] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json() as Promise<HealthResponse>;
      })
      .then((data) => {
        if (data.ok) {
          setStatus("ready");
        } else {
          setStatus("error");
          setDebug(JSON.stringify(data, null, 2));
        }
      })
      .catch((err) => {
        setStatus("error");
        setDebug(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (status === "loading") {
    return <div>Loading...</div>;
  }

  if (status === "error") {
    return (
      <div>
        <p>Error — see debug</p>
        {/* Debug block stub - full implementation in Sprint 03 */}
        {debug && <pre>{debug}</pre>}
      </div>
    );
  }

  return <div>Ready</div>;
}
