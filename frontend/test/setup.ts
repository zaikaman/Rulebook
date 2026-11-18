import '@testing-library/jest-dom/vitest';

// jsdom exposes HTMLDialogElement but does not implement the modal methods.
HTMLDialogElement.prototype.showModal ??= function showModal() {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function close() {
  this.open = false;
};
