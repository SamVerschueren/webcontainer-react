import type { WebContainer, WebContainerProcess } from "@webcontainer/api";
import type { SandpackFiles, SandpackListener, SandpackMessage, SandpackTemplate } from "./types";

export interface ProjectInfo {
  previewUrl: string | null;
  status: "registered" | "starting" | "ready" | "error";
}

interface ProjectState {
  files: SandpackFiles;
  templateId: string;
  serverProcess: WebContainerProcess | null;
  previewUrl: string | null;
  port: number;
  listeners: Set<SandpackListener>;
}

const MAX_CONCURRENT_SERVERS = 20;
const BASE_PORT = 5173;
const SERVER_TIMEOUT_MS = 60_000;

/**
 * Injected into every preview iframe via setPreviewScript to bridge
 * console output and iframe resize events back to the host via postMessage.
 *
 * Message shapes match the SandpackMessage union so the existing
 * Console and Preview components can consume them unchanged.
 */
const BRIDGE_SCRIPT = `(function() {
  var _msgId = 0;

  // --- Console interception ---
  var methods = ['log', 'info', 'warn', 'error', 'debug'];
  methods.forEach(function(method) {
    var original = console[method];
    console[method] = function() {
      original.apply(console, arguments);
      const args = Array.prototype.slice.call(arguments);
      const data = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a));

      if (method === 'debug' && data.join('').startsWith('[vite]')) {
        return;
      }

      window.parent.postMessage({
        type: 'console',
        codesandbox: true,
        log: [{
          method: method,
          id: String(_msgId++),
          data
        }]
      }, '*');
    };
  });

  var originalClear = console.clear;
  console.clear = function() {
    originalClear.apply(console);
    window.parent.postMessage({
      type: 'console',
      codesandbox: true,
      log: [{ method: 'clear', id: String(_msgId++), data: [] }]
    }, '*');
  };

  // --- Resize observation ---
  function observeResize() {
    var root = document.getElementById('root') || document.body;
    new ResizeObserver(function(entries) {
      const { body } = document;
      const html = document.documentElement;
      const height = Math.max(body.scrollHeight, body.offsetHeight, html.offsetHeight);

      window.parent.postMessage({
        type: 'resize',
        height,
      }, '*');
    }).observe(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeResize);
  } else {
    observeResize();
  }

  // --- Uncaught error forwarding ---
  window.addEventListener('error', function(event) {
    window.parent.postMessage({
      type: 'console',
      codesandbox: true,
      log: [{
        method: 'error',
        id: String(_msgId++),
        data: [event.message || 'Unknown error']
      }]
    }, '*');
  });

  window.addEventListener('unhandledrejection', function(event) {
    var msg = event.reason && event.reason.message
      ? event.reason.message
      : String(event.reason || 'Unhandled promise rejection');
    window.parent.postMessage({
      type: 'console',
      codesandbox: true,
      log: [{
        method: 'error',
        id: String(_msgId++),
        data: [msg]
      }]
    }, '*');
  });
})();`;

/**
 * Singleton that manages the single WebContainer instance.
 *
 * Each SandpackProvider registers a 'project' with a unique ID,
 * getting its own folder at /projects/{id}/.
 */
export class WebContainerManager {
  private static instance: WebContainerManager | null = null;

  private container: WebContainer | null = null;
  private bootPromise: Promise<WebContainer> | null = null;
  private projects = new Map<string, ProjectState>();
  private nextPort = BASE_PORT;
  private activeServerCount = 0;
  private pendingServerReady = new Map<number, { resolve: (url: string) => void; reject: (err: Error) => void }>();
  private installedTemplates = new Set<string>();
  private templateInstallPromises = new Map<string, Promise<void>>();

  static getInstance(): WebContainerManager {
    if (!WebContainerManager.instance) {
      WebContainerManager.instance = new WebContainerManager();
    }
    return WebContainerManager.instance;
  }

  private constructor() {}

  /**
   * Lazily boots the WebContainer on first call, installs shared
   * dependencies at /projects/ once, then returns the instance.
   * Subsequent calls return the same instance.
   */
  async boot(): Promise<WebContainer> {
    if (this.container) {
      return this.container;
    }
    if (this.bootPromise) {
      return this.bootPromise;
    }

    this.bootPromise = import("@webcontainer/api")
      .then((module) => module.WebContainer.boot())
      .then(async (container) => {
        this.container = container;
        this.setupContainerListeners(container);
        await container.setPreviewScript(BRIDGE_SCRIPT);
        return container;
      });

    return this.bootPromise;
  }

  /**
   * Installs a template's dependencies at /templates/{id}/ if not
   * already installed. Deduplicates concurrent calls for the same
   * template id. Project subdirectories resolve packages via
   * Node's standard upward module resolution.
   */
  async ensureTemplateInstalled(template: SandpackTemplate): Promise<void> {
    if (this.installedTemplates.has(template.id)) {
      return;
    }

    const existing = this.templateInstallPromises.get(template.id);
    if (existing) {
      return existing;
    }

    const promise = this.doInstallTemplate(template);
    this.templateInstallPromises.set(template.id, promise);

    try {
      await promise;
      this.installedTemplates.add(template.id);
    } finally {
      this.templateInstallPromises.delete(template.id);
    }
  }

  private async doInstallTemplate(template: SandpackTemplate): Promise<void> {
    const container = await this.boot();
    const dir = `/templates/${template.id}`;

    await container.fs.mkdir(dir, { recursive: true });
    await container.fs.writeFile(`${dir}/package.json`, template.environment.packageJson);
    if (template.environment.packageLockJson) {
      await container.fs.writeFile(`${dir}/package-lock.json`, template.environment.packageLockJson);
    }

    const install = await container.spawn("npm", ["install"], { cwd: dir, output: true });

    let installOutput = "";
    install.output
      .pipeTo(
        new WritableStream({
          write(chunk) {
            installOutput += chunk;
          },
        }),
      )
      .catch(() => {});

    const exitCode = await install.exit;
    if (exitCode !== 0) {
      throw new Error(`Template '${template.id}' install failed (exit ${exitCode}):\n${installOutput}`);
    }
  }

  private setupContainerListeners(container: WebContainer): void {
    container.on("server-ready", (port: number, url: string) => {
      console.log("server-ready", port, url);

      const projects = Array.from(this.projects.values());
      for (let i = 0; i < projects.length; i++) {
        if (projects[i].port === port) {
          projects[i].previewUrl = url;
          this.emit(projects[i], { type: "done" });
          break;
        }
      }

      const pending = this.pendingServerReady.get(port);
      if (pending) {
        this.pendingServerReady.delete(port);
        pending.resolve(url);
      }
    });
  }

  /**
   * Registers a project with a unique ID, associates it with a
   * template, and assigns it a port. No-op if already registered.
   */
  registerProject(id: string, files: SandpackFiles, templateId: string): void {
    if (this.projects.has(id)) {
      return;
    }
    this.projects.set(id, {
      files: { ...files },
      templateId,
      serverProcess: null,
      previewUrl: null,
      port: this.nextPort++,
      listeners: new Set(),
    });
  }

  /**
   * Kills any running processes and removes the project entirely.
   */
  async unregisterProject(id: string): Promise<void> {
    await this.killProject(id);
    this.projects.delete(id);
  }

  /**
   * Writes all provided files into /templates/{templateId}/projects/{id}/,
   * creating directories as needed. Merges into existing project files.
   */
  async mountFiles(id: string, files: SandpackFiles): Promise<void> {
    const container = await this.boot();
    const project = this.getProjectOrThrow(id);
    const base = `/templates/${project.templateId}/projects/${id}`;

    const dirs = new Set<string>();
    for (const filePath of Object.keys(files)) {
      const parts = filePath.split("/").filter(Boolean);
      // Collect every ancestor directory under the project root
      for (let i = 1; i < parts.length; i++) {
        dirs.add(`${base}/${parts.slice(0, i).join("/")}`);
      }
    }

    for (const dir of Array.from(dirs).sort()) {
      await container.fs.mkdir(dir, { recursive: true });
    }

    for (const [filePath, file] of Object.entries(files)) {
      await container.fs.writeFile(`${base}${filePath}`, file.code);
    }

    Object.assign(project.files, files);
  }

  /**
   * Writes a single file inside the project folder.
   * Used for live edits from the code editor.
   */
  async writeFile(id: string, filePath: string, content: string): Promise<void> {
    const container = await this.boot();
    const project = this.getProjectOrThrow(id);
    const fullPath = `/templates/${project.templateId}/projects/${id}${filePath}`;
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await container.fs.mkdir(parentDir, { recursive: true });
    await container.fs.writeFile(fullPath, content);
  }

  /**
   * Starts the dev server in the project folder using the
   * template's startCommand. Template dependencies must already
   * be installed via ensureTemplateInstalled().
   * Resolves with the preview URL once the dev server is ready.
   */
  async spawnDevServer(id: string, template: SandpackTemplate): Promise<string> {
    const container = await this.boot();
    const project = this.getProjectOrThrow(id);
    const cwd = `/templates/${template.id}/projects/${id}`;

    this.emit(project, { type: "start", firstLoad: true });

    // --- Evict oldest project if at the concurrency limit ---
    if (this.activeServerCount >= MAX_CONCURRENT_SERVERS) {
      const entries = Array.from(this.projects.entries());
      for (let i = 0; i < entries.length; i++) {
        const [otherId, other] = entries[i];
        if (otherId !== id && other.serverProcess) {
          await this.killProject(otherId);
          break;
        }
      }
    }

    // --- Build the command from the template, replacing {{port}} ---
    const args = template.environment.startCommand.map((arg) => (arg === "{{port}}" ? String(project.port) : arg));
    const [cmd, ...cmdArgs] = args;

    // --- Start dev server ---
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingServerReady.delete(project.port);
        reject(new Error("Dev server did not start within 60 seconds"));
      }, SERVER_TIMEOUT_MS);

      this.pendingServerReady.set(project.port, {
        resolve: (serverUrl: string) => {
          clearTimeout(timeout);
          resolve(serverUrl);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      container
        .spawn(cmd, cmdArgs, { cwd, output: true })
        .then((proc) => {
          project.serverProcess = proc;
          this.activeServerCount++;

          proc.output
            .pipeTo(
              new WritableStream({
                write(chunk) {
                  console.log(chunk);
                },
              }),
            )
            .catch(() => {});

          proc.exit.then((code) => {
            if (project.serverProcess === proc) {
              this.activeServerCount = Math.max(0, this.activeServerCount - 1);
              project.serverProcess = null;
            }

            if (!project.previewUrl) {
              const pending = this.pendingServerReady.get(project.port);
              if (pending) {
                this.pendingServerReady.delete(project.port);
                pending.reject(new Error(`Dev server exited (code ${code}) before server was ready`));
              }
            }
          });
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });

    project.previewUrl = url;
    return url;
  }

  /**
   * Kills the dev server process for the project.
   * The project stays registered and can be restarted with spawnDevServer().
   */
  async killProject(id: string): Promise<void> {
    const project = this.projects.get(id);
    if (!project) {
      return;
    }

    if (project.serverProcess) {
      const proc = project.serverProcess;
      project.serverProcess = null;
      this.activeServerCount = Math.max(0, this.activeServerCount - 1);
      proc.kill();
      await proc.exit;
    }

    project.previewUrl = null;
  }

  /**
   * Subscribes to sandpack messages for a project.
   * Returns an unsubscribe function.
   */
  addListener(id: string, listener: SandpackListener): () => void {
    const project = this.getProjectOrThrow(id);
    project.listeners.add(listener);
    return () => {
      project.listeners.delete(listener);
    };
  }

  getProject(id: string): ProjectInfo | undefined {
    const project = this.projects.get(id);
    if (!project) {
      return undefined;
    }
    let status: ProjectInfo["status"];
    if (project.previewUrl) {
      status = "ready";
    } else if (project.serverProcess) {
      status = "starting";
    } else {
      status = "registered";
    }
    return { previewUrl: project.previewUrl, status };
  }

  getActiveServerCount(): number {
    return this.activeServerCount;
  }

  private getProjectOrThrow(id: string): ProjectState {
    const project = this.projects.get(id);
    if (!project) {
      throw new Error(`Project '${id}' is not registered`);
    }
    return project;
  }

  private emit(project: ProjectState, message: SandpackMessage): void {
    Array.from(project.listeners).forEach((listener) => {
      try {
        listener(message);
      } catch {
        // Don't let one listener's error break others
      }
    });
  }
}
