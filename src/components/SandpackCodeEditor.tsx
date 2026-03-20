import {useRef, useEffect, useState, useCallback} from 'react';
import {EditorView, keymap, lineNumbers, highlightActiveLine, highlightSpecialChars} from '@codemirror/view';
import {EditorState, EditorSelection} from '@codemirror/state';
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentMore,
  indentLess,
  deleteGroupBackward,
} from '@codemirror/commands';
import {bracketMatching, syntaxHighlighting} from '@codemirror/language';
import {useActiveCode} from '../hooks/useActiveCode';
import {useSandpack} from '../hooks/useSandpack';
import {cmTheme, sandpackHighlighter, getLanguageExtension} from '../codemirrorSetup';
import type {SandpackCodeEditorProps} from '../types';

export function SandpackCodeEditor({
  readOnly = false,
  showLineNumbers = false,
  code: codeProp,
  extensions: extraExtensions = [],
}: SandpackCodeEditorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cmRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const {code: contextCode, updateCode} = useActiveCode();
  const {sandpack} = useSandpack();
  const code = codeProp ?? contextCode;
  const [internalCode, setInternalCode] = useState(code);

  const onCodeUpdateRef = useRef(updateCode);
  onCodeUpdateRef.current = updateCode;

  const activeFile = sandpack.activeFile;

  const createView = useCallback(() => {
    if (!cmRef.current) return;

    viewRef.current?.destroy();

    const customKeymap = [
      {
        key: 'Tab',
        run: (view: EditorView) => {
          indentMore(view);
          return true;
        },
      },
      {
        key: 'Shift-Tab',
        run: (view: EditorView) => {
          indentLess(view);
          return true;
        },
      },
      {
        key: 'Escape',
        run: () => {
          wrapperRef.current?.focus();
          return true;
        },
      },
      {
        key: 'mod-Backspace',
        run: deleteGroupBackward,
      },
    ];

    const extensionList = [
      highlightSpecialChars(),
      history(),
      ...extraExtensions,
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...customKeymap,
      ]),
      getLanguageExtension(activeFile),
      cmTheme,
      syntaxHighlighting(sandpackHighlighter),
    ];

    if (readOnly) {
      extensionList.push(EditorState.readOnly.of(true));
      extensionList.push(EditorView.editable.of(false));
    } else {
      extensionList.push(bracketMatching());
      extensionList.push(highlightActiveLine());
    }

    if (showLineNumbers) {
      extensionList.push(lineNumbers());
    }

    const view = new EditorView({
      doc: code,
      extensions: extensionList,
      parent: cmRef.current,
      dispatch(tr) {
        view.update([tr]);
        if (tr.docChanged) {
          const newCode = tr.newDoc.sliceString(0, tr.newDoc.length);
          setInternalCode(newCode);
          onCodeUpdateRef.current(newCode);
        }
      },
    });

    view.contentDOM.setAttribute('data-gramm', 'false');
    view.contentDOM.setAttribute('data-lt-active', 'false');
    view.contentDOM.setAttribute(
      'aria-label',
      activeFile ? `Code Editor for ${activeFile.split('/').pop()}` : 'Code Editor'
    );

    if (!readOnly) {
      view.contentDOM.setAttribute('tabIndex', '-1');
    }

    viewRef.current = view;
  }, [activeFile, readOnly, showLineNumbers, extraExtensions]);

  useEffect(() => {
    createView();
    return () => {
      viewRef.current?.destroy();
    };
  }, [createView]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && typeof code === 'string' && code !== internalCode) {
      const selection = view.state.selection.ranges.some(
        ({to, from}) => to > code.length || from > code.length
      )
        ? EditorSelection.cursor(code.length)
        : view.state.selection;
      view.dispatch({
        changes: {from: 0, to: view.state.doc.length, insert: code},
        selection,
      });
    }
  }, [code]);

  const handleContainerKeyDown = (evt: React.KeyboardEvent) => {
    if (evt.key === 'Enter' && viewRef.current) {
      evt.preventDefault();
      viewRef.current.contentDOM.focus();
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="sp-stack sp-code-editor"
      aria-label={
        activeFile
          ? `Code Editor for ${activeFile.split('/').pop()}`
          : 'Code Editor'
      }
      aria-multiline="true"
      role="textbox"
      tabIndex={0}
      onKeyDown={readOnly ? undefined : handleContainerKeyDown}
      translate="no">
      <div ref={cmRef} className="sp-cm" />
    </div>
  );
}
