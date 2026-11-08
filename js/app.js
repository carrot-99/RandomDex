// 起動、作品の読み込み、画面の切り替え
// 画面は URL の # で切り替える（スマホの戻る操作で前の画面に戻れる）
//   （なし）        抽選画面：待機中・抽選中・結果表示
//   #list           一覧画面
//   #history        抽選履歴画面
//   #item/<id>      詳細画面（一覧・履歴から開く）
import { createRoulette } from './roulette.js';
import { renderDetail } from './detailView.js';
import { createImageSwitcher } from './imageSwitcher.js';
import { createFilterPanel, filterItems, loadSelections, saveSelections, countActiveSelections } from './filter.js';
import { createListView } from './listView.js';
import { loadHistory, addHistory, clearHistory } from './history.js';
import { createHistoryView } from './historyView.js';

const byId = (id) => document.getElementById(id);

const elements = {
  targetCount: byId('targetCount'),
  viewSwitchButton: byId('viewSwitchButton'),
  filterButton: byId('filterButton'),
  filterBadge: byId('filterBadge'),
  filterSheet: byId('filterSheet'),
  // 抽選画面
  drawView: byId('drawView'),
  imageFrame: byId('imageFrame'),
  placeholder: byId('placeholder'),
  resultImage: byId('resultImage'),
  imageLabel: byId('imageLabel'),
  imageDots: byId('imageDots'),
  detailArea: byId('detailArea'),
  itemName: byId('itemName'),
  itemSubName: byId('itemSubName'),
  detailList: byId('detailList'),
  errorMessage: byId('errorMessage'),
  actionBar: byId('actionBar'),
  mainButton: byId('mainButton'),
  // 一覧画面
  listView: byId('listView'),
  searchInput: byId('searchInput'),
  listCount: byId('listCount'),
  itemList: byId('itemList'),
  // 抽選履歴画面
  historyView: byId('historyView'),
  historyList: byId('historyList'),
  historyCount: byId('historyCount'),
  historyClearButton: byId('historyClearButton'),
  backLink: byId('backLink'),
  // 詳細画面
  itemView: byId('itemView'),
  itemImageFrame: byId('itemImageFrame'),
  itemPlaceholder: byId('itemPlaceholder'),
  itemImage: byId('itemImage'),
  itemImageLabel: byId('itemImageLabel'),
  itemImageDots: byId('itemImageDots'),
  itemViewName: byId('itemViewName'),
  itemViewSubName: byId('itemViewSubName'),
  itemViewDetailList: byId('itemViewDetailList'),
};

// 決定後、シルエットのまま止めてからカラーにするまでの時間
const revealDelayMs = 450;

const state = {
  view: 'draw', // draw | list | history | item
  phase: 'idle', // idle | drawing | stopping | result
  workConfig: null,
  items: [],
  itemsById: new Map(),
  targetItems: [],
  // 一覧・履歴のスクロール位置（詳細から戻ったときに使う）
  scrollByView: {},
  // 詳細の「戻る」の行き先
  lastListView: 'list',
  currentItem: null,
};

let listView = null;
let historyView = null;

// index.html の data-version を付けて、データも公開ファイルと同じ版を読む
const assetVersion = document.documentElement.dataset.version ?? '';

async function loadJson(url) {
  const response = await fetch(assetVersion ? `${url}?v=${assetVersion}` : url);
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

// ---------------------------------------------------------------------------
// 抽選画面
// ---------------------------------------------------------------------------

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
  elements.drawView.dataset.state = phase;
  elements.mainButton.dataset.phase = phase;
  elements.mainButton.textContent = phase === 'drawing' || phase === 'stopping' ? 'STOP' : 'START';
  elements.mainButton.disabled = state.targetItems.length === 0 || phase === 'stopping';
  // 抽選中は対象が変わらないよう、絞り込みと画面切り替えをできなくする
  const busy = phase === 'drawing' || phase === 'stopping';
  elements.filterButton.disabled = !state.workConfig || busy;
  elements.viewSwitchButton.classList.toggle('isDisabled', busy);
  elements.viewSwitchButton.setAttribute('aria-disabled', String(busy));
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

function fillDetail({ name, subName, list }, item) {
  name.textContent = item.name;
  subName.textContent = item.subName;
  subName.hidden = !item.subName;
  renderDetail(list, item, state.workConfig);
}

function showResult(item, imageUrl) {
  if (imageUrl) {
    showImage(imageUrl, { silhouette: false });
    imageSwitcher.show(item.images);
  } else {
    showPlaceholder();
  }
  fillDetail({ name: elements.itemName, subName: elements.itemSubName, list: elements.detailList }, item);
  elements.detailArea.hidden = false;
  historyView?.setEntries(addHistory(state.workConfig.workId, item.id));
  setPhase('result');
}

elements.mainButton.addEventListener('click', () => {
  if (state.phase === 'drawing') stopDrawing();
  else if (state.phase === 'idle' || state.phase === 'result') startDrawing();
});

// ---------------------------------------------------------------------------
// 詳細画面（一覧・履歴から開く）
// ---------------------------------------------------------------------------

const itemImageSwitcher = createImageSwitcher({
  frame: elements.itemImageFrame,
  image: elements.itemImage,
  label: elements.itemImageLabel,
  dots: elements.itemImageDots,
});

function showItemView(item) {
  if (item.images.length) {
    elements.itemImage.hidden = false;
    elements.itemPlaceholder.hidden = true;
    itemImageSwitcher.show(item.images);
  } else {
    itemImageSwitcher.hide();
    elements.itemImage.hidden = true;
    elements.itemPlaceholder.hidden = false;
  }
  elements.itemImage.alt = item.name;
  fillDetail({ name: elements.itemViewName, subName: elements.itemViewSubName, list: elements.itemViewDetailList }, item);
}

// 画像の読み込みに失敗したら「？」に戻す
elements.itemImage.addEventListener('error', () => {
  elements.itemImage.hidden = true;
  elements.itemPlaceholder.hidden = false;
});
elements.itemImage.addEventListener('load', () => {
  elements.itemImage.hidden = false;
  elements.itemPlaceholder.hidden = true;
});

// ---------------------------------------------------------------------------
// 画面の切り替え
// ---------------------------------------------------------------------------

function parseHash() {
  const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (hash === 'list') return { view: 'list' };
  if (hash === 'history') return { view: 'history' };
  if (hash.startsWith('item/')) return { view: 'item', id: hash.slice('item/'.length) };
  return { view: 'draw' };
}

function route() {
  if (!state.workConfig) return;
  // 抽選中に戻る操作などで画面が変わらないようにする
  if (state.phase === 'drawing' || state.phase === 'stopping') {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    return;
  }
  const previousView = state.view;
  let { view, id } = parseHash();
  const item = view === 'item' ? state.itemsById.get(id) : null;
  if (view === 'item' && !item) view = 'list';
  // hashchange と popstate の両方で呼ばれても同じ画面なら何もしない
  if (view === previousView && (view !== 'item' || item === state.currentItem)) return;
  state.currentItem = item;

  const isListLike = (name) => name === 'list' || name === 'history';
  if (isListLike(previousView)) state.scrollByView[previousView] = window.scrollY;
  if (isListLike(view)) state.lastListView = view;

  state.view = view;
  document.body.dataset.view = view;
  elements.drawView.hidden = view !== 'draw';
  elements.listView.hidden = view !== 'list';
  elements.historyView.hidden = view !== 'history';
  elements.itemView.hidden = view !== 'item';
  elements.actionBar.hidden = view !== 'draw';
  elements.viewSwitchButton.textContent = view === 'draw' ? '一覧' : '抽選';
  elements.viewSwitchButton.href = view === 'draw' ? '#list' : '#';
  elements.backLink.href = `#${state.lastListView}`;

  if (view === 'item') {
    showItemView(item);
    window.scrollTo({ top: 0 });
  } else if (isListLike(view)) {
    // 詳細から戻ったときは元のスクロール位置に戻す
    window.scrollTo({ top: previousView === 'item' ? state.scrollByView[view] ?? 0 : 0 });
  } else {
    window.scrollTo({ top: 0 });
  }
}

elements.viewSwitchButton.addEventListener('click', (event) => {
  if (elements.viewSwitchButton.classList.contains('isDisabled')) {
    event.preventDefault();
    return;
  }
  // 抽選画面へ戻るときは # を消す
  if (state.view !== 'draw') {
    event.preventDefault();
    history.pushState(null, '', location.pathname + location.search);
    route();
  }
});

// 詳細の「戻る」：一覧・履歴から開いたときはブラウザの戻るを使い、スクロール位置を保つ
elements.backLink.addEventListener('click', (event) => {
  if (history.state?.fromList) {
    event.preventDefault();
    history.back();
  }
});

for (const list of [elements.itemList, elements.historyList]) {
  list.addEventListener('click', (event) => {
    const link = event.target.closest('a.itemLink');
    if (!link) return;
    event.preventDefault();
    history.pushState({ fromList: true }, '', link.getAttribute('href'));
    route();
  });
}

// スクロール位置は自分で戻すので、ブラウザの自動復元は切る
history.scrollRestoration = 'manual';
window.addEventListener('hashchange', route);
window.addEventListener('popstate', route);

// ---------------------------------------------------------------------------
// 絞り込み
// ---------------------------------------------------------------------------

function applySelections(selections) {
  const filters = state.workConfig.filters ?? [];
  state.targetItems = filterItems(state.items, filters, selections);
  elements.targetCount.textContent = `対象 ${state.targetItems.length}件`;
  const activeCount = countActiveSelections(filters, selections);
  elements.filterBadge.textContent = activeCount;
  elements.filterBadge.hidden = activeCount === 0;
  elements.filterButton.classList.toggle('isActive', activeCount > 0);
  listView?.setItems(state.targetItems);
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------

async function init() {
  try {
    const { workConfig, items } = await loadWork();
    state.workConfig = workConfig;
    state.items = items;
    state.itemsById = new Map(items.map((item) => [item.id, item]));
    listView = createListView({
      list: elements.itemList,
      count: elements.listCount,
      searchInput: elements.searchInput,
      workConfig,
    });

    historyView = createHistoryView({
      list: elements.historyList,
      count: elements.historyCount,
      clearButton: elements.historyClearButton,
      workConfig,
      itemsById: state.itemsById,
      onClear() {
        historyView.setEntries(clearHistory(workConfig.workId));
      },
    });
    historyView.setEntries(loadHistory(workConfig.workId));

    const filters = workConfig.filters ?? [];
    const selections = loadSelections(workConfig.workId, filters, items);
    applySelections(selections);

    const filterPanel = createFilterPanel({
      root: elements.filterSheet,
      workConfig,
      items,
      initialSelections: selections,
      onApply(newSelections) {
        saveSelections(workConfig.workId, newSelections);
        applySelections(newSelections);
        setPhase(state.phase);
      },
    });
    elements.filterButton.addEventListener('click', () => filterPanel.open());
    setPhase('idle');
    route();
  } catch (error) {
    elements.targetCount.textContent = '';
    elements.errorMessage.textContent = `${error.message}（再読み込みすると直ることがあります）`;
    elements.errorMessage.hidden = false;
  }
}

init();
