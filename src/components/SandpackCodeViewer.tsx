import {useRef, useEffect, useCallback} from 'react';
import {EditorView} from '@codemirror/view';
import {EditorState} from '@codemirror/state';
import {syntaxHighlighting} from '@codemirror/language';
import {useSandpack} from '../hooks/useSandpack';
import {cmTheme, sandpackHighlighter, getLanguageExtension} from '../codemirrorSetup';
import type {SandpackCodeViewerProps} from '../types';

export function SandpackCodeViewer({code: codeProp}: SandpackCodeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const {sandpack} = useSandpack();
  const activeFile = sandpack.activeFile;
  const contextCode = sandpack.files[activeFile]?.code ?? '';
  const code = codeProp ?? contextCode;

  const createView = useCallback(() => {
    if (!containerRef.current) return;

    viewRef.current?.destroy();

    const view = new EditorView({
      doc: code,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        getLanguageExtension(activeFile),
        cmTheme,
        syntaxHighlighting(sandpackHighlighter),
      ],
      parent: containerRef.current,
    });

    view.contentDOM.classList.add('cm-readonly');
    viewRef.current = view;
  }, [activeFile]);

  useEffect(() => {
    createView();
    return () => {
      viewRef.current?.destroy();
    };
  }, [createView]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && typeof code === 'string') {
      const currentDoc = view.state.doc.sliceString(0);
      if (code !== currentDoc) {
        view.dispatch({
          changes: {from: 0, to: view.state.doc.length, insert: code},
        });
      }
    }
  }, [code]);

  return (
    <div className="sp-code-editor" translate="no">
      <div ref={containerRef} className="sp-cm" />
    </div>
  );
}
