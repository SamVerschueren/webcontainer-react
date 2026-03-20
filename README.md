# @webcontainer/react

Sandpack-compatible React components backed by [WebContainer API](https://webcontainers.io/).

> 🚧 Experimental — under heavy development. This project is an experiment in AI-driven software development. The vast majority of the code, tests, and documentation were written by AI (Cursor). Humans direct architecture, priorities, and design decisions, but have not reviewed most of the code line-by-line. Treat this accordingly — there will be bugs, rough edges, and things that don't work. Use at your own risk.

## Install

```sh
npm install @webcontainer/react
```

## Usage

```tsx
import {
  SandpackProvider,
  SandpackLayout,
  SandpackCodeEditor,
} from '@webcontainer/react';

function App() {
  return (
    <SandpackProvider template="vite-react">
      <SandpackLayout>
        <SandpackCodeEditor />
      </SandpackLayout>
    </SandpackProvider>
  );
}
```

## Exports

- **`SandpackProvider`** — context provider that manages a WebContainer instance
- **`SandpackLayout`** / **`SandpackStack`** — layout primitives
- **`SandpackCodeEditor`** — CodeMirror-based editor
- **`SandpackCodeViewer`** — read-only code viewer
- **`FileTabs`** — file tab bar
- **`OpenInStackBlitzButton`** — open the current project in StackBlitz
- **`useSandpack`** / **`useActiveCode`** / **`useSandpackNavigation`** — hooks

## License

MIT
