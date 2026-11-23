import { useRef, useCallback, useEffect, memo } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { EditorState, Annotation, type Text } from "@codemirror/state";
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
  const composition = useRef<{ view: EditorView; before: Text; deferredSync?: () => void } | null>(null);
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
      composition.current = null;
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
      if (!node) return;
      containerRef.current = node;

      const lang = language ?? (filePath ? detectLanguage(filePath) : "html");

      let lastEmitted = contentRef.current;
      function notify(text: string) {
        if (lastEmitted === text) return;
        lastEmitted = text;
        onChangeRef.current?.(text);
      }
      const typingEvents = EditorView.domEventHandlers({
        compositionstart(_, view) { composition.current = { view, before: view.state.doc }; },
        compositionend(_, view) {
          const input = composition.current;
          // CodeMirror processes the native final input before this microtask.
          queueMicrotask(() => {
            if (!input || composition.current !== input || editorRef.current !== view) return;
            composition.current = null;
            // A confirmed candidate supersedes the earlier receipt; cancelling the
            // candidate lets a deferred update reconcile normally.
            if (input.before.eq(view.state.doc)) input.deferredSync?.();
            else notify(view.state.doc.toString());
            if (!view.hasFocus) onFlushRef.current?.();
          });
        },
        blur() { if (!composition.current) onFlushRef.current?.(); },
      });
      const updateListener = EditorView.updateListener.of((update) => {
        if (!update.docChanged || !onChangeRef.current) return;
        // Ignore programmatic external syncs — only real user edits should save.
        if (update.transactions.some((tr) => tr.annotation(ExternalSync))) {
          lastEmitted = update.state.doc.toString();
          return;
        }
        if (!composition.current) notify(update.state.doc.toString());
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
          keymap.of([{ key: "Mod-s", run: () => { if (!composition.current) onFlushRef.current?.(); return true; } }]),
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
    const sync = () => {
      const current = view.state.doc.toString();
      if (current === content) return;
      // Once a conflicted draft has been discarded, even a focused editor must
      // receive the authoritative content.
      if (view.hasFocus && current !== submitted && (hasPendingChange?.() ?? true)) return;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
        annotations: [ExternalSync.of(true)],
      });
    };
    if (composition.current?.view === view) composition.current.deferredSync = sync;
    else sync();
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
