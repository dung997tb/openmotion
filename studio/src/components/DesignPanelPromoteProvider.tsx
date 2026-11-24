/** Bind variables in the source file that owns the selected element. */
import { useCallback, type ReactNode } from "react";
import type { Composition } from "@hyperframes/sdk";
import type { DomEditSelection } from "./editor/domEditingTypes";
import { useSdkSession } from "../hooks/useSdkSession";
import { useVariablesPersist, type UseVariablesPersistParams } from "../hooks/useVariablesPersist";
import { VariablePromoteProvider } from "../contexts/VariablePromoteContext";
import { getStudioSaveErrorMessage } from "../utils/studioSaveDiagnostics";

export function DesignPanelPromoteProvider({
  selection,
  projectId,
  activeCompPath,
  sdkSession,
  publishSdkSession,
  showToast,
  forceReloadSharedSdkSession,
  children,
  ...persistDeps
}: UseVariablesPersistParams & {
  selection: DomEditSelection | null;
  projectId: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  /** Refresh the host after publishing a change through a separately owned session. */
  forceReloadSharedSdkSession?: () => void;
  children: ReactNode;
}) {
  const targetPath = selection?.hfId ? selection.sourceFile || activeCompPath || "index.html" : null;
  const useShared = targetPath !== null && targetPath === activeCompPath;
  const separate = useSdkSession(projectId, useShared ? null : targetPath);
  const session = useShared ? sdkSession : separate.session;
  const rawPersist = useVariablesPersist({
    ...persistDeps,
    sdkSession: session,
    publishSdkSession: useShared ? publishSdkSession : separate.publish,
    activeCompPath: targetPath,
  });
  const persist = useCallback(
    async (label: string, mutate: (session: Composition) => void) => {
      const committed = await rawPersist(label, mutate);
      if (committed && !useShared) forceReloadSharedSdkSession?.();
      return committed;
    },
    [rawPersist, useShared, forceReloadSharedSdkSession],
  );
  const handlePersistError = useCallback(
    (error: unknown) => showToast(getStudioSaveErrorMessage(error), "error"),
    [showToast],
  );
  return (
    <VariablePromoteProvider
      session={session}
      selection={selection}
      persist={persist}
      onPersistError={handlePersistError}
    >
      {children}
    </VariablePromoteProvider>
  );
}
