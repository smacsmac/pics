import { useEffect } from 'react';

/**
 * Couche d'entrée unique pour la manette et le clavier. Tout le reste de
 * l'interface ne voit que des actions abstraites — aucun composant n'a besoin de
 * savoir si l'utilisateur a poussé le stick ou appuyé sur une flèche.
 */
export type Action =
  | 'up' | 'down' | 'left' | 'right'
  | 'tabPrev' | 'tabNext' // LT / RT : la barre du haut, depuis n'importe où
  | 'confirm'   // A · Entrée · clic
  | 'back'      // B · Échap
  | 'actionX'   // X
  | 'actionY'   // Y
  | 'dec'       // LB
  | 'inc'       // RB
  | 'selectMode' // Back/Select · Alt+S
  | 'setCover'   // clic du stick gauche (LS)
  | 'start';

type Handler = (action: Action) => boolean | void;

const stack: Handler[] = [];

/**
 * Les gestionnaires forment une pile : le dernier monté (une modale, la
 * visionneuse) voit l'action en premier et peut la laisser redescendre en
 * renvoyant false.
 */
export function useInput(handler: Handler, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    stack.push(handler);
    return () => {
      const i = stack.lastIndexOf(handler);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [handler, enabled]);
}

function dispatch(action: Action): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i](action) !== false) return;
  }
}

/** Vrai quand le curseur est dans un champ de saisie : on rend le clavier au texte. */
function typingInField(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

const KEY_MAP: Record<string, Action> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'confirm',
  ' ': 'confirm',
  Escape: 'back',
  Backspace: 'back',
  '[': 'dec',
  ']': 'inc',
  '-': 'dec',
  '=': 'inc',
};

// Manette Xbox en « standard mapping » (ce que Windows + XInput expose au navigateur).
const PAD = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9,
  L3: 10, R3: 11,
  DUP: 12, DDOWN: 13, DLEFT: 14, DRIGHT: 15,
} as const;

const BUTTON_ACTIONS: Array<[number, Action]> = [
  [PAD.A, 'confirm'],
  [PAD.B, 'back'],
  [PAD.X, 'actionX'],
  [PAD.Y, 'actionY'],
  [PAD.LB, 'dec'],
  [PAD.RB, 'inc'],
  // Les gâchettes sont réservées à la barre du haut : elles y ramènent depuis
  // n'importe quel endroit, alors que la croix et le stick restent locaux.
  [PAD.LT, 'tabPrev'],
  [PAD.RT, 'tabNext'],
  [PAD.BACK, 'selectMode'],
  [PAD.L3, 'setCover'],
  [PAD.START, 'start'],
  [PAD.DUP, 'up'],
  [PAD.DDOWN, 'down'],
  [PAD.DLEFT, 'left'],
  [PAD.DRIGHT, 'right'],
];

const REPEAT_DELAY = 380; // ms avant que le maintien se mette à répéter
const REPEAT_RATE = 90;
const DEADZONE = 0.55;

interface HeldState {
  since: number;
  last: number;
}

export interface PadStatus {
  connected: boolean;
  id: string | null;
}

let padStatus: PadStatus = { connected: false, id: null };
const padListeners = new Set<(s: PadStatus) => void>();

export function onPadStatus(fn: (s: PadStatus) => void): () => void {
  padListeners.add(fn);
  fn(padStatus);
  return () => padListeners.delete(fn);
}

function setPadStatus(next: PadStatus): void {
  if (next.connected === padStatus.connected && next.id === padStatus.id) return;
  padStatus = next;
  for (const fn of padListeners) fn(padStatus);
}

let started = false;

/**
 * Démarre l'écoute clavier + la boucle de scrutation de la manette.
 * L'API Gamepad n'expose la manette qu'après une première pression d'un bouton,
 * d'où la boucle permanente plutôt qu'une détection à la connexion.
 */
export function startInput(): void {
  if (started) return;
  started = true;

  window.addEventListener('keydown', (ev) => {
    if (ev.altKey && (ev.key === 's' || ev.key === 'S')) {
      ev.preventDefault();
      dispatch('selectMode');
      return;
    }
    if (typingInField()) {
      // Échap sort quand même du champ, sinon on reste bloqué dedans.
      if (ev.key === 'Escape') {
        (document.activeElement as HTMLElement | null)?.blur();
        dispatch('back');
      }
      return;
    }
    const action = KEY_MAP[ev.key];
    if (!action) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    dispatch(action);
  });

  const held = new Map<string, HeldState>();

  function edge(key: string, active: boolean, action: Action, repeatable: boolean): void {
    const now = performance.now();
    const state = held.get(key);
    if (active) {
      if (!state) {
        held.set(key, { since: now, last: now });
        dispatch(action);
      } else if (repeatable && now - state.since > REPEAT_DELAY && now - state.last > REPEAT_RATE) {
        state.last = now;
        dispatch(action);
      }
    } else if (state) {
      held.delete(key);
    }
  }

  function poll(): void {
    const pads = navigator.getGamepads?.() ?? [];
    let active: Gamepad | null = null;
    for (const pad of pads) {
      if (pad?.connected) {
        active = pad;
        break;
      }
    }
    setPadStatus({ connected: active !== null, id: active?.id ?? null });

    if (active) {
      for (const [index, action] of BUTTON_ACTIONS) {
        const button = active.buttons[index];
        const pressed = button ? button.pressed || button.value > 0.5 : false;
        // Seules les directions se répètent quand on les maintient.
        const repeatable =
          action === 'up' || action === 'down' || action === 'left' || action === 'right' ||
          action === 'dec' || action === 'inc' ||
          action === 'tabPrev' || action === 'tabNext';
        edge(`b${index}`, pressed, action, repeatable);
      }

      const [x = 0, y = 0] = active.axes;
      edge('axL', x < -DEADZONE, 'left', true);
      edge('axR', x > DEADZONE, 'right', true);
      edge('axU', y < -DEADZONE, 'up', true);
      edge('axD', y > DEADZONE, 'down', true);
    } else if (held.size > 0) {
      held.clear();
    }

    requestAnimationFrame(poll);
  }

  requestAnimationFrame(poll);
}
