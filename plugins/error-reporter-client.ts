/// <reference types="vite/client" />

import { parseStack as _parseStack } from "virtual:error-stack-parser";

const _match = window.location.pathname.match(/\/projects\/([^\/]+)/);

const projectId = _match ? _match[1] : null;

function parseStack(stack: string) {
  if (!stack) return [];
  return _parseStack(stack)
    .filter((f) => f.file && f.file.includes("/projects/"))
    .map((f) => ({ file: f.file, line: f.line, column: f.col }));
}

async function send(error: Error) {
  const stack = error && typeof error === "object" && "stack" in error ? String(error.stack || "") : "";

  const frames = parseStack(stack);
  if (frames.length === 0) return;

  const response = await fetch("/__stack-map", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ frames }),
  });

  const data = await response.json();

  const [frame] = data.frames ?? [];

  if (!frame) return;

  sendError({
    message: error.message,
    stack: error.stack,
    file: frame.file,
    line: frame.line,
    column: frame.column,
  });
}

function sendError(error: Record<string, any>) {
  error.file = new URL(error.file, "ws://x").pathname;

  const match = error.file.match(/(?:\/home\/[^/]+\/templates\/[^/]+)?\/projects\/([^\/]+)/);

  const parsedProjectId = match ? match[1] : null;

  if (match) {
    error.file = error.file.replace(match[0], "");
  }

  window.parent.postMessage(
    {
      type: "show-error",
      timestamp: Date.now(),
      projectId: parsedProjectId ?? projectId,
      error,
    },
    "*",
  );
}

window.addEventListener("error", (event) => {
  send(event.error ?? new Error(event.message));
});

window.addEventListener("unhandledrejection", (event) => {
  send(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
});

if (import.meta.hot) {
  import.meta.hot.on("vite:error", (event: any) => {
    if (event.type !== "error") {
      return;
    }

    const error = event.err;

    sendError({
      type: "vite:error",
      message: error.message,
      stack: error.stack,
      file: error.id,
      line: error.loc.line,
      column: error.loc.column,
      frame: error.frame,
    });
  });

  import.meta.hot.on("vite:beforeUpdate", () => {
    window.parent.postMessage(
      {
        type: "clear-error",
        projectId,
        timestamp: Date.now(),
      },
      "*",
    );
  });
}
