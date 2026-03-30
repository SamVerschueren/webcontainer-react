/// <reference types="vite/client" />

import { parseStack as _parseStack } from "virtual:error-stack-parser";

const PROJECT_PATH_RE = /(?:\/home\/[^/]+\/templates\/[^/]+)?\/projects\/([^\/]+)/;

const _match = window.location.pathname.match(PROJECT_PATH_RE);

const projectId = _match ? _match[1] : null;

function parseStack(stack: string) {
  if (!stack) return [];
  return _parseStack(stack)
    .filter((f) => f.file && !f.file.includes("/node_modules/"))
    .map((f) => ({ file: f.file, line: f.line, column: f.col }));
}

async function send(error: Error) {
  const stack = error && typeof error === "object" && "stack" in error ? String(error.stack || "") : "";

  const frames = parseStack(stack);

  if (frames.length === 0) {
    return;
  }

  if (frames[0].file.startsWith("about://React/")) {
    const file = frames[0].file.split("file://")[1];

    sendError({
      title: "Runtime Error",
      file,
      message: error.message,
      stack: error.stack,
    });

    return;
  }

  const response = await fetch("/__stack-map", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ frames }),
  });

  const data = await response.json();

  const [frame] = data.frames ?? [];

  if (!frame) return;

  sendError({
    title: "Runtime Error",
    message: error.message,
    stack: error.stack,
    file: frame.file,
    line: frame.line,
    column: frame.column,
  });
}

function sendError(error: Record<string, any>) {
  error.file = new URL(error.file, "ws://x").pathname;

  const match = error.file.match(PROJECT_PATH_RE);

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

function clearError(event?: { file: string }) {
  const match = event?.file.match(PROJECT_PATH_RE);

  const parsedProjectId = match ? match[1] : null;

  window.parent.postMessage(
    {
      type: "clear-error",
      timestamp: Date.now(),
      projectId: parsedProjectId ?? projectId,
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

    if (error.plugin === "vite:react-babel") {
      const match = error.message.match(
        new RegExp(`^${error.id}: (.*?) \\(${error.loc.line}:${error.loc.column}\\)$`, "m"),
      );

      if (match) {
        error.message = match[1];
      }
    } else if (error.plugin === "vite:esbuild") {
      error.message = error.frame.trim().split("\n")[0];
    }

    sendError({
      title: "Error",
      message: error.message,
      stack: error.stack,
      file: error.id,
      line: error.loc.line,
      column: error.loc.column,
    });
  });

  import.meta.hot.on("vite:beforeUpdate", () => {
    clearError();
  });

  import.meta.hot.on("rsc:update", (event: { file: string }) => {
    clearError({ file: event.file });
  });
}
