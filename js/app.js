// 起動、作品の読み込み、画面状態（待機中・抽選中・結果表示）の切り替え
import { createRoulette } from './roulette.js';
import { renderDetail } from './detailView.js';
import { createImageSwitcher } from './imageSwitcher.js';

const elements = {
  main: document.getElementById('appMain'),
  targetCount: document.getElementById('targetCount'),
  imageFrame: document.getElementById('imageFrame'),
  placeholder: document.getElementById('placeholder'),
  resultImage: document.getElementById('resultImage'),
  imageLabel: document.getElementById('imageLabel'),
  imageDots: document.getElementById('imageDots'),
  detailArea: document.getElementById('detailArea'),
  itemName: document.getElementById('itemName'),
  itemSubName: document.getElementById('itemSubName'),
  detailList: document.getElementById('detailList'),
  errorMessage: document.getElementById('errorMessage'),
  mainButton: document.getElementById('mainButton'),
};

// 決定後、シルエットのまま止めてからカラーにするまでの時間
const revealDelayMs = 450;

const state = {
  phase: 'idle', // idle | drawing | stopping | result
  workConfig: null,
  items: [],
  targetItems: [],
};

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} の読み込みに失敗しました（${response.status}）`);
  return response.json();
}

async function loadWork() {
  const workList = await loadJson('./works/workList.json');
  const work = [...workList].sort((a, b) => a.order - b.order)[0];
  const [workConfig, items] = await Promise.all([
    loadJson(`./works/${work.workId}/workConfig.json`),
    loadJson(`./works/${work.workId}/items.json`),
  ]);
  return { workConfig, items };
}

function showImage(url, { silhouette }) {
  elements.resultImage.src = url;
  elements.resultImage.classList.toggle('isSilhouette', silhouette);
  elements.resultImage.hidden = false;
  elements.placeholder.hidden = true;
}

function showPlaceholder() {
  elements.resultImage.hidden = true;
  elements.resultImage.removeAttribute('src');
  elements.placeholder.hidden = false;
}

const roulette = createRoulette({
  onFrame(url) {
    showImage(url, { silhouette: true });
  },
});

const imageSwitcher = createImageSwitcher({
  frame: elements.imageFrame,
  image: elements.resultImage,
  label: elements.imageLabel,
  dots: elements.imageDots,
});

function setPhase(phase) {
  state.phase = phase;
  elements.main.dataset.state = phase;
  elements.mainButton.dataset.phase = phase;
  elements.mainButton.textContent = phase === 'drawing' || phase === 'stopping' ? 'STOP' : 'START';
  elements.mainButton.disabled = state.targetItems.length === 0 || phase === 'stopping';
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startDrawing() {
  imageSwitcher.hide();
  elements.detailArea.hidden = true;
  showPlaceholder();
  window.scrollTo({ top: 0 });
  roulette.start(state.targetItems);
  setPhase('drawing');
}

async function stopDrawing() {
  setPhase('stopping');
  const result = await roulette.stop();
  if (!result) {
    showPlaceholder();
    setPhase('idle');
    return;
  }
  await wait(revealDelayMs);
  showResult(result.item, result.imageUrl);
}

function showResult(item, imageUrl) {
  if (imageUrl) {
    showImage(imageUrl, { silhouette: false });
    imageSwitcher.show(item.images);
  } else {
    showPlaceholder();
  }
  elements.itemName.textContent = item.name;
  elements.itemSubName.textContent = item.subName;
  elements.itemSubName.hidden = !item.subName;
  renderDetail(elements.detailList, item, state.workConfig);
  elements.detailArea.hidden = false;
  setPhase('result');
}

elements.mainButton.addEventListener('click', () => {
  if (state.phase === 'drawing') stopDrawing();
  else if (state.phase === 'idle' || state.phase === 'result') startDrawing();
});

async function init() {
  try {
    const { workConfig, items } = await loadWork();
    state.workConfig = workConfig;
    state.items = items;
    state.targetItems = items;
    elements.targetCount.textContent = `対象 ${state.targetItems.length}件`;
    setPhase('idle');
  } catch (error) {
    elements.targetCount.textContent = '';
    elements.errorMessage.textContent = error.message;
    elements.errorMessage.hidden = false;
  }
}

init();
