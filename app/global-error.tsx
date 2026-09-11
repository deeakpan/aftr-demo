"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#000", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 24,
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 13, opacity: 0.7, maxWidth: 420, margin: 0 }}>
            {error.message || "The app crashed while loading. Try reloading."}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 8,
              borderRadius: 999,
              border: "none",
              background: "#fff",
              color: "#000",
              fontWeight: 600,
              padding: "10px 18px",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
