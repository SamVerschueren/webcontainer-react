import type {Extension} from '@codemirror/state';
import {Annotation} from '@codemirror/state';
import type {DecorationSet, ViewUpdate} from '@codemirror/view';
import {Decoration, ViewPlugin} from '@codemirror/view';

export const showErrorAnnotation = Annotation.define<number>();
export const removeErrorsAnnotation = Annotation.define<boolean>();

const lineDeco = Decoration.line({attributes: {class: 'cm-errorLine'}});

const errorLineHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor() {
      this.decorations = Decoration.none;
    }

    update(update: ViewUpdate): void {
      for (const tr of update.transactions) {
        const errorLine = tr.annotation(showErrorAnnotation);
        if (errorLine !== undefined) {
          const lineInfo = update.view.state.doc.line(errorLine);
          this.decorations = Decoration.set([lineDeco.range(lineInfo.from)]);
        } else if (tr.annotation(removeErrorsAnnotation)) {
          this.decorations = Decoration.none;
        }
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

export function highlightInlineError(): Extension {
  return errorLineHighlighter;
}
