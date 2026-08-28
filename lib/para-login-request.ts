/** User clicked Sign in — drives auth modal vs silent bridge. */
let paraLoginRequested = false;
let signInAttempt = 0;
type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export function markParaLoginRequested() {
  paraLoginRequested = true;
  signInAttempt += 1;
  emit();
}

export function isParaLoginRequested() {
  return paraLoginRequested;
}

export function getSignInAttempt() {
  return signInAttempt;
}

export function clearParaLoginRequested() {
  paraLoginRequested = false;
  emit();
}

export function subscribeParaLoginState(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}
