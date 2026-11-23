import { useRef, useCallback, useEffect, memo } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { EditorState, Annotation } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { studioCodeTheme } from "./studioCodeTheme";

// Marks a programmatic doc sync (external content push — e.g. a manual-edit
// commit writing the source) so the update listener doesn't mistake it for a
// user keystroke and trigger a re-save + preview reload.
const ExternalSync = Annotation.define<boolean>();

const LANGUAGE_EXTENSIONS: Record<string, () => Extension> = {
  html: () => html(),
  css: () => css(),
  markdown: () => markdown(),
  md: () => markdown(),
  javascript: () => javascript(),
  js: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  ts: () => javascript({ typescript: true }),
};

function getLanguageExtension(language: string): Extension {
  const factory = LANGUAGE_EXTENSIONS[language] ?? html;
  return factory();
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "html",
    htm: "html",
    css: "css",
    js: "javascript",
    ts: "typescript",
    jsx: "javascript",
    tsx: "typescript",
    json: "javascript",
    md: "markdown",
    markdown: "markdown",
  };
  return map[ext] ?? "html";
}

interface SourceEditorProps {
  content: string;
  submitted?: string;
  filePath?: string;
  language?: string;
  onChange?: (content: string) => void;
  onFlush?: () => void;
  hasPendingChange?: () => boolean;
  readOnly?: boolean;
  revealOffset?: number | null;
}

export const SourceEditor = memo(function SourceEditor({
  content,
  submitted,
  filePath,
  language,
  onChange,
  onFlush,
  hasPendingChange,
  readOnly = false,
  revealOffset,
}: SourceEditorProps) {
  const editorRef = useRef<EditorView | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;

  const contentRef = useRef(content);
  contentRef.current = content;

  // fallow-ignore-next-line complexity
  const mountEditor = useCallback(
    (node: HTMLDivElement | null) => {
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
      if (!node) return;
      containerRef.current = node;

      const lang = language ?? (filePath ? detectLanguage(filePath) : "html");

      let composing = false;
      let lastEmitted = contentRef.current;
      function notify(text: string) {
        if (lastEmitted === text) return;
        lastEmitted = text;
        onChangeRef.current?.(text);
      }
      const typingEvents = EditorView.domEventHandlers({
        compositionstart() { composing = true; },
        compositionend(_, view) {
          composing = false;
          // CodeMirror processes the native final input before this microtask.
          queueMicrotask(() => {
            if (editorRef.current !== view) return;
            notify(view.state.doc.toString());
            if (!view.hasFocus) onFlushRef.current?.();
          });
        },
        blur() { if (!composing) onFlushRef.current?.(); },
      });
      const updateListener = EditorView.updateListener.of((update) => {
        if (!update.docChanged || !onChangeRef.current) return;
        // Ignore programmatic external syncs — only real user edits should save.
        if (update.transactions.some((tr) => tr.annotation(ExternalSync))) {
          lastEmitted = update.state.doc.toString();
          return;
        }
        if (!composing) notify(update.state.doc.toString());
      });

      const state = EditorState.create({
        doc: contentRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          foldGutter(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          typingEvents,
          keymap.of([{ key: "Mod-s", run: () => { if (!composing) onFlushRef.current?.(); return true; } }]),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap]),
          getLanguageExtension(lang),
          studioCodeTheme,
          updateListener,
          EditorState.readOnly.of(readOnly),
        ],
      });

      editorRef.current = new EditorView({ state, parent: node });
    },
    [filePath, language, readOnly],
  );

  // Sync external content changes into the editor without recreating it.
  // Only applies when the new content differs from the current document
  // (e.g. file switch or server refresh), not on every keystroke.
  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === content) return;
    // An old receipt must never replace newer typing. Once that draft is
    // discarded after a conflict, the authoritative content must also reach a focused editor.
    if (view.hasFocus && current !== submitted && (hasPendingChange?.() ?? true)) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: content },
      annotations: [ExternalSync.of(true)],
    });
  }, [content, submitted]);

  useEffect(() => {
    const view = editorRef.current;
    if (!view || revealOffset == null || revealOffset < 0) return;
    const docLen = view.state.doc.length;
    const pos = Math.min(revealOffset, docLen);
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
  }, [revealOffset]);

  return <div ref={mountEditor} className="h-full w-full overflow-hidden" />;
});
