// 見た目違いの切り替え（結果表示中のみ）
// - 画像の左右スワイプで前後の画像へ、タップで次の画像へ
// - 画像の下に現在のラベルとドットを表示。見た目違いが無いときは出さない

const swipeThresholdPx = 40;
const tapThresholdPx = 10;

export function createImageSwitcher({ frame, image, label, dots, onChange }) {
  let images = [];
  let index = 0;
  let enabled = false;
  let pointerStart = null;

  function render() {
    const current = images[index];
    if (!current) return;
    image.src = current.url;
    const hasVariants = images.length > 1;
    label.textContent = hasVariants ? current.label : '';
    label.hidden = !hasVariants;
    dots.hidden = !hasVariants;
    dots.replaceChildren(...(hasVariants ? images.map((_, i) => {
      const dot = document.createElement('span');
      dot.className = i === index ? 'dot isActive' : 'dot';
      return dot;
    }) : []));
    frame.classList.toggle('isSwitchable', hasVariants);
    onChange?.(current);
  }

  function go(step) {
    if (!enabled || images.length < 2) return;
    index = (index + step + images.length) % images.length;
    render();
  }

  function show(itemImages) {
    images = itemImages;
    index = 0;
    enabled = true;
    render();
  }

  function hide() {
    enabled = false;
    images = [];
    label.hidden = true;
    dots.hidden = true;
    dots.replaceChildren();
    frame.classList.remove('isSwitchable');
  }

  frame.addEventListener('pointerdown', (event) => {
    if (!enabled) return;
    pointerStart = { x: event.clientX, y: event.clientY };
  });

  frame.addEventListener('pointerup', (event) => {
    if (!enabled || !pointerStart) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.abs(dx) >= swipeThresholdPx && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
    } else if (Math.abs(dx) < tapThresholdPx && Math.abs(dy) < tapThresholdPx) {
      go(1);
    }
  });

  frame.addEventListener('pointercancel', () => {
    pointerStart = null;
  });

  return { show, hide };
}
