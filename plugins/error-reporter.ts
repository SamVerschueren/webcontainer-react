import type { Plugin, ViteDevServer, Connect } from "vite";
import type { ServerResponse, IncomingMessage } from "node:http";
import type { SourceMapInput } from "@jridgewell/trace-mapping";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

declare const __ERROR_STACK_PARSER_SOURCE__: string;
declare const __CLIENT_CODE__: string;

interface StackFrame {
  file: string;
  line: number;
  column: number;
  name?: string | null;
}

const VIRTUAL_ID = "virtual:debug-mapped-errors-client";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;

const PARSER_VIRTUAL_ID = "virtual:error-stack-parser";
const RESOLVED_PARSER_VIRTUAL_ID = "\0" + PARSER_VIRTUAL_ID;

export function debugMappedErrors(): Plugin {
  return {
    name: "debug-mapped-errors",

    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      if (id === PARSER_VIRTUAL_ID) return RESOLVED_PARSER_VIRTUAL_ID;
      return undefined;
    },

    load(id: string) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return __CLIENT_CODE__;
      }
      if (id === RESOLVED_PARSER_VIRTUAL_ID) {
        return __ERROR_STACK_PARSER_SOURCE__;
      }
      return undefined;
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        "/__stack-map",
        async (
          req: Connect.IncomingMessage,
          res: ServerResponse,
        ) => {
          try {
            const body = await readJson(req);
            const frames: StackFrame[] = (body as { frames?: StackFrame[] })
              .frames ?? [];

            const mapped = await Promise.all(
              frames.map((frame) => mapFrame(server, frame)),
            );

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ frames: mapped }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error:
                  error instanceof Error ? error.message : String(error),
              }),
            );
          }
        },
      );
    },

    transformIndexHtml: {
      order: "post",
      handler() {
        return [
          {
            tag: "script",
            attrs: {
              type: "module",
              src: "/@id/" + VIRTUAL_ID,
            },
            injectTo: "head" as const,
          },
        ];
      },
    },
  };
}

async function mapFrame(server: ViteDevServer, frame: StackFrame) {
  const url = normalizeToViteUrl(frame.file);

  if (!url) {
    return {
      ...frame,
      reason: "unsupported-frame-url",
    };
  }

  const result = await server.environments.client.transformRequest(url);

  if (!result?.map || result.map.mappings === "") {
    return {
      ...frame,
      file: url,
      reason: "no-sourcemap",
    };
  }

  const map = new TraceMap(result.map as SourceMapInput);
  const pos = originalPositionFor(map, {
    line: frame.line,
    column: frame.column,
  });

  if (!pos.source) {
    return {
      ...frame,
      file: url,
    };
  }

  return {
    ...frame,
    file: url,
    line: pos.line,
    column: pos.column,
    name: pos.name ?? null,
  };
}

function normalizeToViteUrl(file: string): string | null {
  try {
    const u = new URL(file, "ws://x");
    return u.pathname + u.search;
  } catch {
    return file.startsWith("/") ? file : null;
  }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: string | Buffer) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
