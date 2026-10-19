/**
 * Client for {@link BadgerCopilot} — the agentic layer, kept separate from
 * `api/badger.ts` because it is a different kind of call.
 *
 * Everything in `api/badger.ts` is a deterministic read: the same spec returns the
 * same rows. This module calls a model that *decides* which of the three agents'
 * methods to run. The contract that makes that safe is carried in the response and
 * is the reason this file exists rather than an inline `c3Action`: every figure in
 * `reply` must correspond to an entry in {@link CopilotTurn.toolCalls}, and
 * `grounded === false` means the model answered without computing anything and the
 * UI must label it unverified.
 *
 * Two platform quirks are absorbed here so no component has to know about them:
 *
 * 1. **Arrays may arrive as objects keyed by stringified index** (`{"0": …}`)
 *    rather than as JSON arrays. This bit the server implementation too. Every
 *    list crossing this boundary goes through {@link toArray}.
 * 2. **The method takes a single `json` spec**, not positional parameters, because
 *    `c3Action` prepends the type name to the argument array — which would shift
 *    positional arguments by one. One object argument is unambiguous and matches
 *    the shape `fetch`/`evaluate` already use successfully in this app.
 */

import { c3Action } from '@/c3Action';

/** Which page is asking. Biases tool choice and decides whether a `uiAction` applies. */
export type CopilotPage = 'overview' | 'planner' | 'intercept' | 'map' | 'methodology';

/**
 * One executed agent method, as rendered in the provenance strip beneath an answer.
 * This is the artifact that distinguishes a computed answer from a generated one.
 */
export interface CopilotToolCall {
  /** Manifest name, e.g. `planner_solve` — the `agent_method` convention. */
  name: string;
  /** The arguments actually sent, so a reader can replay the call themselves. */
  args: Record<string, unknown>;
  /** Server-side elapsed milliseconds. */
  ms: number;
  /** One-line result précis, pre-computed server-side. */
  summary: string;
}

/**
 * An instruction for the calling page to mutate its **own** state.
 *
 * The planner uses this so "we can only cut laptops 4%" physically moves the
 * sliders. `pins` are read off the arguments the solver was actually invoked with
 * — never restated by the model — so the controls and the narration cannot drift.
 */
export interface CopilotUiAction {
  type: 'planner.applyPins';
  /** Category id → reduction **percent, 0–100**. The planner divides by 100. */
  pins: Record<string, number>;
  targetYear: number;
  /** Already mapped to the frontend's `'equal' | 'cheapest' | 'effort'` naming. */
  strategy: string;
  /**
   * Pins whose value looked like a 0–1 fraction (`0 < v <= 1`) and may therefore
   * be a units mistake by the model. Reported, never silently corrected.
   */
  suspectFractions: Record<string, number>;
}

/** A write the model proposed. Held for human approval; never executed by `ask`. */
export interface CopilotPendingAction {
  name: string;
  args: Record<string, unknown>;
  description?: string;
  summary?: string;
}

/** The full envelope returned by `BadgerCopilot.ask`. */
export interface CopilotTurn {
  reply: string;
  toolCalls: CopilotToolCall[];
  uiAction: CopilotUiAction | null;
  pendingAction: CopilotPendingAction | null;
  /** False when the model answered with no tool call — show it as unverified. */
  grounded: boolean;
  model: string;
  /** Populated instead of throwing, so a chat failure never takes the page down. */
  error: string | null;
}

/** Result of executing a held write through `BadgerCopilot.confirmAction`. */
export interface CopilotConfirmResult {
  ok: boolean;
  result: unknown;
  summary: string;
  error: string | null;
}

/** One argument of a declared tool, as the model sees it. */
export interface CopilotParamSpec {
  name: string;
  type: string;
  required: boolean;
  /** Allowed values when the argument is an enum, else null. */
  enumValues: string[] | null;
  description: string;
}

/** One declared capability, for the methodology page's transparency table. */
export interface CopilotToolSpec {
  name: string;
  /** The C3 type that implements it, e.g. `PlannerAgent`. */
  backs: string;
  write: boolean;
  confirmGated: boolean;
  description: string;
  params: CopilotParamSpec[];
}

export interface CopilotManifest {
  model: string;
  maxToolRounds: number;
  readOnlyCount: number;
  writeCount: number;
  groundingRule: string;
  tools: CopilotToolSpec[];
}

/** A turn in the transcript the UI keeps, including the user's own messages. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: CopilotToolCall[];
  grounded?: boolean;
  pendingAction?: CopilotPendingAction | null;
  error?: string | null;
}

/**
 * Normalises a value the platform may hand back either as a JSON array or as an
 * object keyed by stringified index. Anything else becomes an empty array, so a
 * malformed payload renders as "no tool calls" rather than crashing the panel.
 */
function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (value as Record<string, T>)[k]);
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumberMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const src = asRecord(value);
  for (const key of Object.keys(src)) {
    const n = Number(src[key]);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

/** Coerces the raw `uiAction` payload, dropping anything we do not know how to apply. */
function normaliseUiAction(raw: unknown): CopilotUiAction | null {
  const obj = asRecord(raw);
  if (obj.type !== 'planner.applyPins') return null;
  const pins = asNumberMap(obj.pins);
  if (Object.keys(pins).length === 0) return null;
  return {
    type: 'planner.applyPins',
    pins,
    targetYear: Number(obj.targetYear) || 2030,
    strategy: typeof obj.strategy === 'string' ? obj.strategy : 'equal',
    suspectFractions: asNumberMap(obj.suspectFractions),
  };
}

function normalisePendingAction(raw: unknown): CopilotPendingAction | null {
  const obj = asRecord(raw);
  if (typeof obj.name !== 'string' || !obj.name) return null;
  return {
    name: obj.name,
    args: asRecord(obj.args),
    description: typeof obj.description === 'string' ? obj.description : undefined,
    summary: typeof obj.summary === 'string' ? obj.summary : undefined,
  };
}

function normaliseTurn(raw: unknown): CopilotTurn {
  const obj = asRecord(raw);
  return {
    reply: typeof obj.reply === 'string' ? obj.reply : '',
    toolCalls: toArray<Record<string, unknown>>(obj.toolCalls).map((c) => ({
      name: typeof c.name === 'string' ? c.name : 'unknown',
      args: asRecord(c.args),
      ms: Number(c.ms) || 0,
      summary: typeof c.summary === 'string' ? c.summary : '',
    })),
    uiAction: normaliseUiAction(obj.uiAction),
    pendingAction: normalisePendingAction(obj.pendingAction),
    grounded: obj.grounded === true,
    model: typeof obj.model === 'string' ? obj.model : '',
    error: typeof obj.error === 'string' ? obj.error : null,
  };
}

/**
 * Ask the copilot one question.
 *
 * @param message   The user's question in natural language.
 * @param page      Which page is asking, so tool selection is biased sensibly.
 * @param scenario  The caller's live on-screen state, so "what if we *also* …"
 *                  resolves against what the user is actually looking at.
 * @param history   Prior turns, oldest first. Only `role` and `content` are sent —
 *                  the tool-call metadata is local UI state and would waste tokens.
 */
export async function askCopilot(
  message: string,
  page: CopilotPage,
  scenario: Record<string, unknown> | null,
  history: ChatTurn[],
): Promise<CopilotTurn> {
  const raw = await c3Action('BadgerCopilot', 'ask', {
    message,
    page,
    scenario: scenario ?? {},
    history: history.map((t) => ({ role: t.role, content: t.content })),
  });
  return normaliseTurn(raw);
}

/** Execute a held write after a human has approved it. */
export async function confirmCopilotAction(
  action: CopilotPendingAction,
): Promise<CopilotConfirmResult> {
  const raw = await c3Action('BadgerCopilot', 'confirmAction', {
    name: action.name,
    args: action.args,
  });
  const obj = asRecord(raw);
  return {
    ok: obj.ok === true,
    result: obj.result ?? null,
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    error: typeof obj.error === 'string' ? obj.error : null,
  };
}

/** The agent's declared capabilities, as handed to the model. */
export async function fetchCopilotManifest(): Promise<CopilotManifest> {
  // `[]` rather than no third argument: it serialises to a well-formed, zero-argument
  // envelope (`["BadgerCopilot"]`) instead of a POST with no body at all.
  const raw = await c3Action('BadgerCopilot', 'toolManifest', []);
  const obj = asRecord(raw);
  return {
    model: typeof obj.model === 'string' ? obj.model : '',
    maxToolRounds: Number(obj.maxToolRounds) || 0,
    readOnlyCount: Number(obj.readOnlyCount) || 0,
    writeCount: Number(obj.writeCount) || 0,
    groundingRule: typeof obj.groundingRule === 'string' ? obj.groundingRule : '',
    tools: toArray<Record<string, unknown>>(obj.tools).map((t) => ({
      name: typeof t.name === 'string' ? t.name : '',
      backs: typeof t.backs === 'string' ? t.backs : '',
      write: t.write === true,
      confirmGated: t.confirmGated === true,
      description: typeof t.description === 'string' ? t.description : '',
      // Both the parameter list and each enum inside it arrive object-keyed.
      params: toArray<Record<string, unknown>>(t.params).map((p) => ({
        name: typeof p.name === 'string' ? p.name : '',
        type: typeof p.type === 'string' ? p.type : 'string',
        required: p.required === true,
        enumValues: p.enumValues ? toArray<string>(p.enumValues) : null,
        description: typeof p.description === 'string' ? p.description : '',
      })),
    })),
  };
}
