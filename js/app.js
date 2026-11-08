// 起動、作品の読み込み、画面状態（待機中・抽選中・結果表示）の切り替え
import { createRoulette } from './roulette.js';
import { renderDetail } from './detailView.js';

const elements = {
  main: document.getElementById('appMain'),
  targetCount: document.getElementById('targetCount'),
  placeholder: document.getElementById('placeholder'),
  resultImage: document.getElementById('resultImage'),
  shuffleName: document.getElementById('shuffleName'),
  detailArea: document.getElementById('detailArea'),
  itemName: document.getElementById('itemName'),
  itemSubName: document.getElementById('itemSubName'),
  detailList: document.getElementById('detailList'),
  errorMessage: document.getElementById('errorMessage'),
  mainButton: document.getElementById('mainButton'),
};

const state = {
  phase: 'idle', // idle | drawing | result
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

const roulette = createRoulette({
  onTick(item) {
    elements.shuffleName.textContent = item.name;
  },
});

function setPhase(phase) {
  state.phase = phase;
  elements.main.dataset.state = phase;
  elements.mainButton.dataset.phase = phase;
  elements.mainButton.textContent = phase === 'drawing' ? 'STOP' : 'START';
  elements.mainButton.disabled = state.targetItems.length === 0;
}

function showIdle() {
  elements.placeholder.hidden = false;
  elements.resultImage.hidden = true;
  elements.detailArea.hidden = true;
  elements.shuffleName.textContent = '';
  setPhase('idle');
}

function startDrawing() {
  elements.placeholder.hidden = false;
  elements.resultImage.hidden = true;
  elements.detailArea.hidden = true;
  window.scrollTo({ top: 0 });
  roulette.start(state.targetItems);
  setPhase('drawing');
}

function stopDrawing() {
  const item = roulette.stop();
  showResult(item);
}

function showResult(item) {
  const image = item.images[0];
  elements.shuffleName.textContent = '';
  if (image) {
    elements.resultImage.src = image.url;
    elements.resultImage.alt = item.name;
    elements.resultImage.hidden = false;
    elements.placeholder.hidden = true;
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
  else startDrawing();
});

async function init() {
  try {
    const { workConfig, items } = await loadWork();
    state.workConfig = workConfig;
    state.items = items;
    state.targetItems = items;
    elements.targetCount.textContent = `対象 ${state.targetItems.length}件`;
    showIdle();
  } catch (error) {
    elements.targetCount.textContent = '';
    elements.errorMessage.textContent = error.message;
    elements.errorMessage.hidden = false;
  }
}

init();
