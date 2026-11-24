import { workflowIdSchema, type AssistantPage } from '@rulebook/shared';
import { SparklesIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useMatch } from 'react-router';

import { Button } from '@/ui';
import { AssistantPanel } from './AssistantPanel.js';

interface AssistantControls {
  readonly isOpen: boolean;
  readonly open: () => void;
  readonly close: () => void;
}

const AssistantContext = createContext<AssistantControls | null>(null);

export function useAssistant() {
  const value = useContext(AssistantContext);
  if (!value) throw new Error('AssistantProvider is missing from the workspace shell.');
  return value;
}

export function AssistantProvider({ children }: { readonly children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const { pathname } = useLocation();
  const workflow = useMatch('/workflows/:id');
  const parsedWorkflowId = workflowIdSchema.safeParse(workflow?.params.id);
  const workflowId = parsedWorkflowId.success ? parsedWorkflowId.data : undefined;
  const page = useMemo<AssistantPage>(
    () => ({ path: pathname, ...(workflowId ? { workflowId } : {}) }),
    [pathname, workflowId],
  );
  const value = useMemo<AssistantControls>(
    () => ({ isOpen, open: () => setOpen(true), close: () => setOpen(false) }),
    [isOpen],
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
      <AssistantPanel open={isOpen} page={page} onClose={() => setOpen(false)} />
    </AssistantContext.Provider>
  );
}

/** Visible in focused layouts, where the topbar and mobile navigation are hidden. */
export function AssistantLauncher() {
  const { open } = useAssistant();
  return (
    <Button variant="primary" className="app-assistant-launcher" onClick={open}>
      <HugeiconsIcon icon={SparklesIcon} size={16} strokeWidth={1.8} aria-hidden="true" />
      Ask Bookkeeper
    </Button>
  );
}
