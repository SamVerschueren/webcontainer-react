import type {ReactNode} from 'react';
import {useSandpack} from '../hooks/useSandpack';
import {rootPackageJson, rootPackageJsonLock} from '../templates/vite-react';

interface OpenInStackBlitzButtonProps {
  className?: string;
  title?: string;
  children?: ReactNode;
}

export function OpenInStackBlitzButton({
  className,
  title = 'Open in StackBlitz',
  children,
}: OpenInStackBlitzButtonProps) {
  const {sandpack} = useSandpack();

  function handleOpen() {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://stackblitz.com/run?file=src/App.js';
    form.target = '_blank';

    addInput(form, 'project[title]', 'React Sandbox');
    addInput(form, 'project[template]', 'node');

    const hasPackageJson = Object.keys(sandpack.files).some(
      (p) => p === '/package.json' || p === 'package.json'
    );

    if (!hasPackageJson) {
      addInput(form, 'project[files][package.json]', rootPackageJson);
      addInput(
        form,
        'project[files][package-lock.json]',
        rootPackageJsonLock
      );
    }

    for (const [path, {code}] of Object.entries(sandpack.files)) {
      const normalized = path.startsWith('/') ? path.slice(1) : path;
      addInput(form, `project[files][${normalized}]`, code);
    }

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  return (
    <button
      className={className}
      onClick={handleOpen}
      title={title}
      type="button">
      {children ?? 'Open in StackBlitz!!!'}
    </button>
  );
}

function addInput(form: HTMLFormElement, name: string, value: string) {
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = name;
  input.value = value;
  form.appendChild(input);
}
