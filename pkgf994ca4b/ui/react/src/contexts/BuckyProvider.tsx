/*
 * Bucky's conversation state, hoisted out of any one page.
 *
 * The transcript used to live in `useState` inside the chat panel, which meant every
 * page owned a *different* conversation and all of them were destroyed on navigation.
 * That is the wrong shape for this application specifically: the interesting questions
 * cross pages ("the Chemistry Building is worst — is there spare stock there?" starts on
 * the map and is answered by the intercept), and a user who navigates to look at what
 * Bucky just told them should not come back to an empty box. So the transcript lives
 * here, above the router, and there is exactly one of it.
 *
 * ## The binding problem, and why `useBuckyBinding` exists
 *
 * Hoisting the transcript above the router creates one genuine difficulty. Bucky can
 * return a `uiAction` — "I solved with these pins, move your sliders to match" — but the
 * sliders belong to a page *below* the router, which the dock cannot see. Likewise the
 * planner's live pin state needs to reach the model so "what if we **also** capped
 * plastics?" resolves against what the user is looking at.
 *
 * The fix is a one-slot mutable binding that the mounted page writes on every render
 * through {@link useBuckyBinding}. It is a ref rather than state on purpose: a page
 * passing a fresh `onUiAction` closure each render would otherwise re-render the whole
 * provider subtree on every keystroke, and the obvious `useEffect` version loops forever
 * because the dependency is a new function identity every time.
 *
 * Reading the binding at *resolution* time rather than at send time also gets the
 * navigation case right for free: if the user leaves the planner while a request is in
 * flight, the unmount clears the binding and the returning `uiAction` is dropped instead
 * of writing pins into a page that no longer exists.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';

import {
  askCopilot,
  type ChatTurn,
  type CopilotPage,
  type CopilotUiAction,
} from '@/api/copilot';

/** What a mounted page contributes to the conversation while it is on screen. */
export interface BuckyBinding {
  /** Live on-screen state, serialised into the model's instructions. */
  scenario?: Record<string, unknown> | null;
  /** Applied when Bucky's answer implies the page should change its own controls. */
  onUiAction?: (action: CopilotUiAction) => void;
  /** Called after a confirmed write succeeds, so the page can refetch. */
  onWriteCommitted?: () => void;
}

interface BuckyContextValue {
  /** The single transcript, oldest turn first. */
  turns: ChatTurn[];
  /** True while a question is in flight — both surfaces disable input on it. */
  busy: boolean;
  /** Whether the floating dock is expanded. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Which page is asking, derived from the route rather than passed down. */
  page: CopilotPage;
  /** Starter questions appropriate to the current page. */
  suggestions: string[];
  /** Ask a question. Resolves when the answer has been appended. */
  send: (text: string) => Promise<void>;
  /** Open the dock and ask in one go — for "ask Bucky about this" links in prose. */
  openAndAsk: (text: string) => void;
  /** Discard the transcript. */
  clear: () => void;
  /** Internal: the one-slot page binding. Use {@link useBuckyBinding} instead. */
  bindingRef: React.MutableRefObject<BuckyBinding>;
}

const BuckyContext = createContext<BuckyContextValue | null>(null);

/**
 * Route path → the `page` value the model is told about.
 *
 * Kept here rather than threaded through props because the dock is mounted outside
 * `<Routes>` and has no page component to ask. Anything unmatched falls back to
 * `overview`, which biases toward the campus-wide tools — the safest default for a
 * question asked from a page we do not recognise.
 */
const PAGE_BY_PATH: Record<string, CopilotPage> = {
  '/': 'overview',
  '/map': 'map',
  '/intercept': 'intercept',
  '/planner': 'planner',
  '/methodology': 'methodology',
};

/**
 * Per-page starter questions.
 *
 * Each one is chosen to be answerable by one or two tool calls and to demonstrate
 * something the page itself does not show — there is no value in a starter that asks
 * for a number already rendered six inches above it.
 */
const SUGGESTIONS: Record<CopilotPage, string[]> = {
  overview: [
    'Which three departments should I call first, and why those three?',
    'How much of the footprint sits in the top three categories?',
    'Is our purchasing carbon trending up or down?',
  ],
  map: [
    'Which building is trending up fastest, and by how much?',
    'What does the Chemistry Building look like next year?',
    'Which building emits most, and is there spare stock there we could reuse?',
  ],
  intercept: [
    'What is the single highest-impact request in the queue right now?',
    "How much carbon could today's queue avoid if I actioned everything?",
    'Which pending request would you leave alone, and why?',
  ],
  planner: [
    'We can only cut IT hardware 4% — can we still hit 2030?',
    'What is the cheapest route to the 2030 target?',
    'Which category is doing the most work in the current plan?',
  ],
  methodology: [
    'Where does the emission factor for lab supplies come from?',
    'Which of these numbers are measured and which are modelled?',
    'What is the biggest weakness in this method?',
  ],
};

export function BuckyProvider({ children }: { children: React.ReactNode }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const bindingRef = useRef<BuckyBinding>({});
  const { pathname } = useLocation();

  const page: CopilotPage = PAGE_BY_PATH[pathname] ?? 'overview';

  // The page is read at send time from a ref for the same reason the binding is: a
  // question submitted immediately after a navigation should carry the page the user is
  // actually on, not the one captured when `send` was memoised.
  const pageRef = useRef(page);
  pageRef.current = page;

  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  const busyRef = useRef(busy);
  busyRef.current = busy;

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || busyRef.current) return;

    const history = turnsRef.current;
    setTurns([...history, { role: 'user', content: message }]);
    setBusy(true);

    try {
      const res = await askCopilot(
        message,
        pageRef.current,
        bindingRef.current.scenario ?? null,
        history,
      );
      setTurns((cur) => [
        ...cur,
        {
          role: 'assistant',
          content: res.reply || res.error || 'I did not get an answer back. Please try rephrasing.',
          toolCalls: res.toolCalls,
          grounded: res.grounded,
          pendingAction: res.pendingAction,
          error: res.error,
        },
      ]);
      // Read the handler now, not when the request was sent: if the user has navigated
      // away from the page that could apply this, there is deliberately nowhere to put it.
      const apply = bindingRef.current.onUiAction;
      if (res.uiAction && apply) apply(res.uiAction);
    } catch (e) {
      setTurns((cur) => [
        ...cur,
        {
          role: 'assistant',
          content:
            'The call to Bucky failed, so I have not answered. Everything else on this page is unaffected and still live.',
          error: e instanceof Error ? e.message : String(e),
          grounded: false,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }, []);

  const openAndAsk = useCallback(
    (text: string) => {
      setOpen(true);
      void send(text);
    },
    [send],
  );

  const clear = useCallback(() => setTurns([]), []);

  const value = useMemo<BuckyContextValue>(
    () => ({
      turns,
      busy,
      open,
      setOpen,
      page,
      suggestions: SUGGESTIONS[page] ?? SUGGESTIONS.overview,
      send,
      openAndAsk,
      clear,
      bindingRef,
    }),
    [turns, busy, open, page, send, openAndAsk, clear],
  );

  return <BuckyContext.Provider value={value}>{children}</BuckyContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBucky(): BuckyContextValue {
  const ctx = useContext(BuckyContext);
  if (!ctx) throw new Error('useBucky must be used inside a BuckyProvider');
  return ctx;
}

/**
 * Let the page currently on screen contribute its live state and its action handlers to
 * the conversation.
 *
 * Call it unconditionally from a page component. The binding is written during render
 * (cheap, and the only way to keep a fresh closure current without an effect loop) and
 * cleared on unmount, so a handler never outlives the page that owns it.
 *
 * Only pages that have something to contribute need this — a page with no live controls
 * and nothing Bucky can drive is better off not calling it at all.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useBuckyBinding(binding: BuckyBinding): void {
  const { bindingRef } = useBucky();
  bindingRef.current = binding;
  useEffect(
    () => () => {
      bindingRef.current = {};
    },
    [bindingRef],
  );
}
