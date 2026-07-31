// ==========================================
// 設定
// ==========================================
const API = 'https://script.google.com/macros/s/AKfycbxQDXKnv25TXoml5LjmyAkWP7DiFhFCYUGbBFWJJsK0tMI_5ROesPQSjsZNe-YTKQ/exec';
const TTL = 5 * 60 * 1000; // キャッシュ有効期間：5分

const DAYS = ['火', '水', '木', '金', '土'];
const PERIODS = [
  { id: 'p1',     label: '1〜2時限', time: '9:00〜10:30'  },
  { id: 'chapel', label: 'チャペル', time: '10:35〜11:00' },
  { id: 'p2',     label: '3〜4時限', time: '11:05〜12:35' },
];
const PERIOD_RANGE = {
  p1:     { start: 540, end: 630 },
  chapel: { start: 635, end: 660 },
  p2:     { start: 665, end: 755 },
};

// ==========================================
// データ取得（JSONP + localStorage キャッシュ）
// ==========================================
function fetchSheet(sheet) {
  const key = `seminary_${sheet}`;

  // キャッシュが有効なら即返す
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < TTL) return Promise.resolve(data);
    }
  } catch (_) {}

  return new Promise((resolve) => {
    const cbName = `_seminary_cb_${sheet}_${Date.now()}`;

    // コールバック関数を一時登録
    window[cbName] = (data) => {
      delete window[cbName];
      const el = document.getElementById(cbName);
      if (el) el.remove();
      try {
        localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
      } catch (_) {}
      resolve(Array.isArray(data) ? data : []);
    };

    // scriptタグでJSONP呼び出し
    const script    = document.createElement('script');
    script.id       = cbName;
    script.src      = `${API}?sheet=${sheet}&callback=${cbName}`;
    script.onerror  = () => {
      console.warn(`[${sheet}] JSONP失敗。キャッシュを使用します。`);
      delete window[cbName];
      try {
        const cached = localStorage.getItem(key);
        resolve(cached ? JSON.parse(cached).data : []);
      } catch (_) {
        resolve([]);
      }
    };
    document.head.appendChild(script);
  });
}

// ==========================================
// ユーティリティ
// ==========================================
function todayLabel() {
  return ['日', '月', '火', '水', '木', '金', '土'][new Date().getDay()];
}

function currentPeriodId() {
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const [id, { start, end }] of Object.entries(PERIOD_RANGE)) {
    if (mins >= start && mins <= end) return id;
  }
  return null;
}

function classAt(classes, period, day) {
  return classes.find(c => c.period === period && c.day === day) || null;
}

function toBool(val) {
  return val === true || String(val).toUpperCase() === 'TRUE';
}

// ==========================================
// 休暇期間（vacationsシート）
// ==========================================

// 日付をYYYY-MM-DDのみに正規化（時刻付きISO文字列にも対応）
function toDateOnly(val) {
  if (!val) return null;
  const s = String(val);
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 本日が休暇期間内かどうかを判定し、該当する行（start/end/messageなど）を返す
function getActiveVacation(vacations) {
  if (!Array.isArray(vacations) || !vacations.length) return null;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return vacations.find(v => {
    const start = toDateOnly(v.start);
    const end   = toDateOnly(v.end);
    return start && end && todayStr >= start && todayStr <= end;
  }) || null;
}

// ==========================================
// ホーム：ライブカード
// ==========================================
function renderLiveCard(classes, vacation) {
  const now = new Date();
  const day = todayLabel();
  const pid = currentPeriodId();

  // 現在時刻表示
  document.getElementById('now-time').textContent =
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${day}）` +
    ` ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 休暇期間中は放送中バッジ・Zoomボタンを出さず、専用の案内のみ表示する
  if (vacation) {
    document.getElementById('now-subject').textContent = vacation.message || '現在は休暇期間中です';
    document.getElementById('now-teacher').textContent = '';
    document.getElementById('live-badge').classList.add('hidden');
    document.getElementById('vacation-badge')?.classList.remove('hidden');
    document.getElementById('live-actions').classList.add('hidden');
    const hint = document.getElementById('off-hint');
    hint.textContent = vacation.note || '休暇期間のため、授業はお休みです。';
    hint.classList.remove('hidden');
    return;
  }
  document.getElementById('vacation-badge')?.classList.add('hidden');

  const active = (pid && DAYS.includes(day)) ? classAt(classes, pid, day) : null;

  if (!active || !active.subject) {
    document.getElementById('now-subject').textContent = '現在は授業時間外です';
    document.getElementById('now-teacher').textContent = '';
    document.getElementById('live-badge').classList.add('hidden');
    document.getElementById('live-actions').classList.add('hidden');
    const hint = document.getElementById('off-hint');
    hint.textContent = '⏳ 本日の予定は「時間割」または「授業資料」からご確認ください。';
    hint.classList.remove('hidden');
    return;
  }

  document.getElementById('now-subject').textContent =
    active.subject + (active.note ? `（${active.note}）` : '');
  document.getElementById('now-teacher').textContent =
    active.teacher ? `担当：${active.teacher} 師` : 'チャペル（礼拝）';
  document.getElementById('live-badge').classList.remove('hidden');
  document.getElementById('off-hint').classList.add('hidden');

  if (pid !== 'chapel') {
    document.getElementById('live-actions').classList.remove('hidden');
    const zoomBtn = document.getElementById('zoom-btn');
    if (active.zoomUrl && String(active.zoomUrl).startsWith('http')) {
      zoomBtn.onclick   = () => window.open(active.zoomUrl, '_blank');
      zoomBtn.disabled  = false;
      zoomBtn.innerHTML = '<i class="fa-solid fa-video"></i> Zoomで参加する';
    } else {
      zoomBtn.disabled  = true;
      zoomBtn.innerHTML = 'Zoom URL 未設定';
      zoomBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
  }
}

// ==========================================
// ホーム：お知らせ
// ==========================================

// ISO日付文字列 → 日本語表記（JST補正）
function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

function renderAnnouncements(data) {
  const el     = document.getElementById('announcements-list');
  const active = data.filter(a => toBool(a.active));

  if (!active.length) {
    el.innerHTML = '<p class="text-gray-400">現在お知らせはありません。</p>';
    return;
  }

  el.innerHTML = active.map(a => `
    <div class="border-l-4 border-[#4a5d23] pl-4 py-1">
      <p class="text-sm text-gray-400 mb-1">${formatDate(a.date)}</p>
      <p class="font-bold text-[#2c3614]">${a.title}</p>
      <p class="text-gray-600 text-sm mt-1 leading-relaxed">${a.body}</p>
    </div>
  `).join('');
}

// ==========================================
// 時間割
// ==========================================
function renderTimetable(classes, vacation) {
  const today = todayLabel();
  const pid   = vacation ? null : currentPeriodId();

  const headerCells = DAYS.map(d => `
    <th class="border border-[#2c3614] p-3 text-sm min-w-[100px]
               ${d === today ? 'today-header' : ''}">${d}</th>
  `).join('');

  const bodyRows = PERIODS.map(p => {
    const cells = DAYS.map(d => {
      const cls      = classAt(classes, p.id, d);
      const isToday  = d === today;
      const isActive = isToday && pid === p.id;
      const tdCls    = [
        'border border-gray-200 p-2 align-top text-center',
        isToday  ? 'today-col'  : '',
        isActive ? 'live-cell'  : '',
      ].join(' ');

      // 空セル（授業なし）― リンクスロット2行分を確保して高さを揃える
      if (!cls || !cls.subject) {
        return `<td class="${tdCls}" style="height:1px">
          <div class="flex flex-col h-full">
            <div class="flex-1"></div>
            <div class="border-t border-gray-100 flex flex-col items-center py-1">
              <span style="height:1.3rem;display:block"></span>
              <span style="height:1.3rem;display:block"></span>
            </div>
          </div>
        </td>`;
      }

      const hasZoom  = cls.zoomUrl  && String(cls.zoomUrl).startsWith('http');
      const hasDrive = cls.driveUrl && String(cls.driveUrl).startsWith('http');

      // Zoomスロット：リンクがなくても同じ高さのspanを置く
      const zoomSlot = (hasZoom && p.id !== 'chapel')
        ? `<a href="${cls.zoomUrl}" target="_blank" rel="noopener"
              style="height:1.3rem;display:flex;align-items:center;justify-content:center;gap:4px"
              class="text-[#4a5d23] font-bold text-xs hover:underline">
             <i class="fa-solid fa-video" style="font-size:9px"></i> Zoom
           </a>`
        : `<span style="height:1.3rem;display:block"></span>`;

      // 資料スロット：リンクがなくても同じ高さのspanを置く
      const driveSlot = hasDrive
        ? `<a href="${cls.driveUrl}" target="_blank" rel="noopener"
              style="height:1.3rem;display:flex;align-items:center;justify-content:center;gap:4px"
              class="text-[#8b5a2b] font-bold text-xs hover:underline">
             <i class="fa-solid fa-folder-open" style="font-size:9px"></i> 資料
           </a>`
        : `<span style="height:1.3rem;display:block"></span>`;

      return `
        <td class="${tdCls}" style="height:1px">
          <div class="flex flex-col h-full">

            <!-- 上段：科目・担当（上揃え・横センター） -->
            <div class="flex-1 flex flex-col items-center text-center px-2 pt-3 pb-1">
              ${p.id !== 'chapel'
                ? (toBool(cls.isPublic)
                    ? '<span class="text-[10px] text-[#4a5d23] font-bold mb-1" style="height:1.2rem;display:block">📢 公開授業</span>'
                    : '<span style="height:1.2rem;display:block"></span>')
                : ''}
              <span class="font-bold text-sm leading-snug">${cls.subject}</span>
              ${cls.note    ? `<span class="text-xs text-gray-400 mt-0.5">${cls.note}</span>`    : ''}
              ${cls.teacher ? `<span class="text-xs text-gray-500 mt-1">${cls.teacher}</span>` : ''}
            </div>

            <!-- 下段：固定高さスロット（Zoom・資料 各1.3rem） -->
            <div class="border-t border-gray-100 flex flex-col items-center py-1">
              ${zoomSlot}
              ${driveSlot}
            </div>

          </div>
        </td>`;
    }).join('');

    return `
      <tr>
        <td class="border border-gray-200 bg-[#fdfbf7] p-3 text-center font-bold text-sm whitespace-nowrap">
          ${p.label}<br>
          <span class="text-xs font-normal text-gray-400">${p.time}</span>
        </td>
        ${cells}
      </tr>`;
  }).join('');

  document.getElementById('timetable-wrap').innerHTML = `
    <table class="w-full border-collapse border-2 border-[#2c3614]">
      <thead>
        <tr class="bg-[#2c3614] text-white text-center">
          <th class="border border-[#2c3614] p-3 text-sm min-w-[80px]">時間</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
}

// ==========================================
// 授業資料（曜日別）
// ==========================================
function renderMaterials(classes) {
  const today = todayLabel();
  const el    = document.getElementById('materials-list');

  el.innerHTML = DAYS.map(day => {
    const isToday = day === today;
    const dayCls  = classes.filter(c => c.day === day && c.period !== 'chapel');

    const cards = dayCls.map(cls => {
      const period   = PERIODS.find(p => p.id === cls.period);
      const hasDrive = cls.driveUrl && String(cls.driveUrl).startsWith('http');
      return `
        <div class="bg-white border-2 ${isToday ? 'border-[#8b5a2b]' : 'border-gray-100'}
                    rounded-2xl p-5 hover:shadow-md transition">
          <p class="text-xs font-bold text-[#4a5d23] mb-1">
            ${period ? period.label : cls.period}
          </p>
          <p class="font-bold text-[#2c3614]">
            ${cls.subject}${cls.note ? `（${cls.note}）` : ''}
          </p>
          <p class="text-sm text-gray-500 mt-1">担当：${cls.teacher} 師</p>
          ${hasDrive
            ? `<a href="${cls.driveUrl}" target="_blank" rel="noopener"
                  class="mt-3 inline-flex items-center gap-2 text-[#4a5d23] font-bold text-sm hover:underline">
                 <i class="fa-solid fa-folder-open"></i> 資料を開く
               </a>`
            : `<p class="mt-3 text-xs text-gray-400">資料は登録されておりません</p>`
          }
        </div>`;
    }).join('') || '<p class="text-gray-300 text-sm">この曜日に授業はありません。</p>';

    return `
      <div class="rounded-2xl border-2
                  ${isToday ? 'border-[#8b5a2b] bg-yellow-50' : 'border-gray-100 bg-white'}
                  p-6">
        <div class="flex items-center gap-3 mb-5">
          <span class="text-2xl font-black ${isToday ? 'text-[#8b5a2b]' : 'text-[#2c3614]'}">
            ${day}曜日
          </span>
          ${isToday
            ? '<span class="bg-[#8b5a2b] text-white text-xs px-2 py-0.5 rounded-full font-bold">本日</span>'
            : ''}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${cards}</div>
      </div>`;
  }).join('');
}

// ==========================================
// 授業動画アーカイブ
// ==========================================
function renderArchives(data) {
  const el = document.getElementById('archives-list');

  if (!data.length) {
    el.innerHTML = '<p class="text-gray-400 col-span-3">動画はまだ登録されていません。</p>';
    return;
  }

  el.innerHTML = data.map(a => `
    <div class="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition">
      <div class="bg-gray-100 h-28 rounded-xl flex items-center justify-center text-5xl mb-4">🎥</div>
      <p class="font-bold text-[#2c3614]">${a.subject}</p>
      <p class="text-sm text-gray-500 mt-1">担当：${a.teacher}</p>
      ${a.youtubeUrl && String(a.youtubeUrl).startsWith('http')
        ? `<a href="${a.youtubeUrl}" target="_blank" rel="noopener"
              class="mt-4 flex items-center justify-center gap-2
                     bg-red-600 hover:bg-red-700 text-white py-3
                     rounded-xl font-bold transition">
             <i class="fa-brands fa-youtube"></i> YouTubeで見る
           </a>`
        : `<p class="mt-4 text-center text-xs text-gray-300">準備中</p>`
      }
    </div>`).join('');
}

// ==========================================
// ナビゲーション
// ==========================================
function navigate(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${id}`)?.classList.add('active');

  document.querySelectorAll('[data-nav]').forEach(b => b.classList.remove('nav-active'));
  document.querySelectorAll(`[data-nav="${id}"]`).forEach(b => b.classList.add('nav-active'));

  document.getElementById('mobile-menu')?.classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// 初期化
// ==========================================
async function init() {
  // モバイルメニュー
  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    document.getElementById('mobile-menu')?.classList.toggle('hidden');
  });

  // 読み込み中表示（データ取得前）
  document.getElementById('now-time').textContent    = '';
  document.getElementById('now-subject').textContent = '読み込み中...';
  document.getElementById('now-teacher').textContent = '';
  document.getElementById('off-hint').classList.add('hidden');
  document.getElementById('live-badge').classList.add('hidden');
  document.getElementById('live-actions').classList.add('hidden');

  // 全シートを並列取得（vacationsは休暇期間の登録用シート。start/end/message列を想定）
  const [classes, announcements, archives, vacations] = await Promise.all([
    fetchSheet('classes'),
    fetchSheet('announcements'),
    fetchSheet('archives'),
    fetchSheet('vacations'),
  ]);

  // 全セクション描画
  const activeVacation = getActiveVacation(vacations);
  renderLiveCard(classes, activeVacation);
  renderAnnouncements(announcements);
  renderTimetable(classes, activeVacation);
  renderArchives(archives);

  // 1分ごとにライブ状態を更新（日付が変わって休暇に入る/明ける場合も反映されるよう毎回判定し直す）
  setInterval(() => {
    const vac = getActiveVacation(vacations);
    renderLiveCard(classes, vac);
    renderTimetable(classes, vac);
  }, 60 * 1000);

  navigate('home');
}

document.addEventListener('DOMContentLoaded', init);
