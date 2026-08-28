/** True after user clicks Sign in — avoids passive page-load spinner on Para cookie restore. */
let paraLoginRequested = false;

export function markParaLoginRequested() {
  paraLoginRequested = true;
}

export function isParaLoginRequested() {
  return paraLoginRequested;
}

export function clearParaLoginRequested() {
  paraLoginRequested = false;
}
