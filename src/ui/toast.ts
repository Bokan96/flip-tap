/** Small notices that slide in at the top of the screen and disappear by themselves. */
export function toast(icon: string, title: string, text: string): void {
  let stack = document.querySelector<HTMLElement>('.toasts');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toasts';
    document.body.appendChild(stack);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-icon">${icon}\uFE0E</span><div><b>${title}</b><span>${text}</span></div>`;
  stack.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4300);
}
