// ==========================================
// 設定
// ==========================================
const DAYS = ['火', '水', '木', '金', '土'];
const PERIODS = [
  { id: 'p1', label: '1〜2時限', time: '9:00〜10:30' },
  { id: 'chapel', label: 'チャペル', time: '10:35〜11:00' },
  { id: 'p2', label: '3〜4時限', time: '11:05〜12:35' },
];
const PERIOD_RANGE = {
  p1: { start: 540, end: 630 },
  chapel: { start: 635, end: 660 },
  p2: { start: 665, end: 755 },
};

// ==========================================
// データ取得（静的JSON + localStorage キャッシュフォールバック）
// ==========================================
async function fetchSheet(sheet) {
  const key = `seminary_${sheet}`;

  try {
    // 静的JSONファイルを取得 (キャッシュバスティング用タイムスタンプ付与)
    const res = await fetch(`./data/${sheet}.json?t=${Date.now()}`);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();

    // 成功したデータを localStorage にキャッシュ
    try {
      localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
    } catch (_) { }

    return Array.isArray(data) ? data : (data || []);
  } catch (err) {
    console.warn(`[${sheet}] 静的JSONの取得に失敗しました。キャッシュを使用します:`, err);
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const { data } = JSON.parse(cached);
        return Array.isArray(data) ? data : (data || []);
      }
    } catch (_) { }
    return [];
  }
}

// ==========================================
// ユーティリティ
// ==========================================
function todayLabel() {
  return ['日', '月', '火', '水', '木', '金', '土'][new Date().getDay()];
}

function currentPeriodId() {
  const now = new Date();
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

// 日付をYYYY-MM-DDのみに正規化（GAS/SheetsがUTCシリアライズしたISO日時にも対応）
function toDateOnly(val) {
  if (!val) return null;
  const s = String(val);
  // "2026-07-26" のような日付のみの文字列はそのまま使う
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // シートの日付はUTCとしてシリアライズされて届くため、JST（+9時間）に補正してから日付を取り出す
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
}

// 本日が休暇期間内かどうかを判定し、該当する行（start/end/messageなど）を返す
function getActiveVacation(vacations) {
  if (!Array.isArray(vacations) || !vacations.length) return null;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return vacations.find(v => {
    const start = toDateOnly(v.start);
    const end = toDateOnly(v.end);
    return start && end && todayStr >= start && todayStr <= end;
  }) || null;
}

// ==========================================
// 集中講義（intensiveシート）
// ==========================================
// 想定列：title / teacher / period / startAt / endAt / description / zoomUrl / driveUrl / youtubeUrl / archived

// 猶予時間（分）：Zoomボタンは開始のこの分数前から押せる／終了のこの分数後まで「実施中」扱い
const INTENSIVE_JOIN_BUFFER_MIN = 30;

// 掲載中の集中講義リストを取得（titleがあり、archivedがFALSEのもの）
function getPublicIntensiveList(intensiveRaw) {
  const list = Array.isArray(intensiveRaw) ? intensiveRaw : (intensiveRaw ? [intensiveRaw] : []);
  return list
    .filter(row => row && row.title && !toBool(row.archived))
    .sort((a, b) => {
      const ta = parseDateTime(a.startAt)?.getTime() || 0;
      const tb = parseDateTime(b.startAt)?.getTime() || 0;
      return ta - tb;
    });
}

// 日時文字列を各ブラウザで安定してDateオブジェクトにパース
function parseDateTime(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;

  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;

  const sIso = s.replace(' ', 'T');
  d = new Date(sIso);
  if (!isNaN(d.getTime())) return d;

  const match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (match) {
    const [_, y, m, day, h = 0, min = 0, sec = 0] = match;
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(day, 10), parseInt(h, 10), parseInt(min, 10), parseInt(sec, 10));
  }
  return null;
}

// 集中講義単体の現在の状態を判定する
// 'before' = まだ参加受付前 / 'live' = 参加可能（開始30分前〜終了30分後） / 'ended' = 終了（終了30分経過後） / 'none' = 対象外
function getIntensiveWindowStatus(row) {
  if (!row || !row.title || toBool(row.archived) || !row.startAt || !row.endAt) return 'none';
  const start = parseDateTime(row.startAt);
  const end = parseDateTime(row.endAt);
  if (!start || !end) return 'none';

  const now = new Date();
  const joinFrom = new Date(start.getTime() - INTENSIVE_JOIN_BUFFER_MIN * 60 * 1000);
  const endedAt = new Date(end.getTime() + INTENSIVE_JOIN_BUFFER_MIN * 60 * 1000);

  if (now < joinFrom) return 'before';
  if (now <= endedAt) return 'live';
  return 'ended';
}

// ホーム画面に表示すべき集中講義とそのステータスを判定
// 次回講義の開始30分前までは、直前の講義（ended）を表示し続ける
function getActiveIntensiveForHome(publicList) {
  if (!publicList || !publicList.length) return { row: null, status: 'none' };

  const now = new Date();

  // ① 開催中（開始30分前 〜 終了30分後）の講義があるか
  for (const row of publicList) {
    const status = getIntensiveWindowStatus(row);
    if (status === 'live') return { row, status: 'live' };
  }

  // ② 開催中がない場合、次回講義の開始30分前までは直前に終了した講義（ended）を表示
  for (let i = 0; i < publicList.length; i++) {
    const row = publicList[i];
    if (!row.startAt) continue;
    const start = parseDateTime(row.startAt);
    if (!start) continue;
    const joinFrom = new Date(start.getTime() - INTENSIVE_JOIN_BUFFER_MIN * 60 * 1000);

    if (now < joinFrom) {
      if (i > 0) {
        return { row: publicList[i - 1], status: 'ended' };
      } else {
        return { row: publicList[0], status: 'before' };
      }
    }
  }

  // ③ すべての講義終了後
  const lastRow = publicList[publicList.length - 1];
  return { row: lastRow, status: 'ended' };
}

// period欄の表示用フォーマット
function formatPeriodDisplay(val) {
  if (!val) return '';
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
      return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
    }
  }
  return s;
}

// 資料ボタンを通常状態（時間割の資料ページへの導線）に戻す
function resetMaterialsBtn() {
  const btn = document.getElementById('materials-btn');
  if (!btn) return;
  btn.onclick = () => navigate('materials');
  btn.disabled = false;
  btn.classList.remove('opacity-50', 'cursor-not-allowed');
  btn.innerHTML = '<i class="fa-solid fa-folder-open"></i> この授業の資料';
}

function renderLiveCard(classes, vacation, intensiveList) {
  const now = new Date();
  const day = todayLabel();
  const pid = currentPeriodId();

  // 現在時刻表示
  document.getElementById('now-time').textContent =
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${day}）` +
    ` ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

  const publicIntensiveList = getPublicIntensiveList(intensiveList);
  const { row: activeIntensive, status: intensiveStatus } = getActiveIntensiveForHome(publicIntensiveList);

  // ① 集中講義の実施時間帯／終了保持時間帯は最優先で表示
  if (intensiveStatus === 'live' && activeIntensive) {
    document.getElementById('now-subject').textContent = activeIntensive.title;
    document.getElementById('now-teacher').textContent =
      activeIntensive.teacher ? `担当：${activeIntensive.teacher} 師` : '';
    document.getElementById('live-badge').classList.remove('hidden');
    document.getElementById('vacation-badge')?.classList.add('hidden');
    document.getElementById('intensive-ended-badge')?.classList.add('hidden');
    document.getElementById('off-hint').classList.add('hidden');
    document.getElementById('live-actions').classList.remove('hidden');

    const zoomBtn = document.getElementById('zoom-btn');
    if (activeIntensive.zoomUrl && String(activeIntensive.zoomUrl).startsWith('http')) {
      zoomBtn.onclick = () => window.open(activeIntensive.zoomUrl, '_blank');
      zoomBtn.disabled = false;
      zoomBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      zoomBtn.innerHTML = '<i class="fa-solid fa-video"></i> Zoomで参加する';
    } else {
      zoomBtn.disabled = true;
      zoomBtn.innerHTML = 'Zoom URL 未設定';
      zoomBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    const materialsBtn = document.getElementById('materials-btn');
    if (activeIntensive.driveUrl && String(activeIntensive.driveUrl).startsWith('http')) {
      materialsBtn.onclick = () => window.open(activeIntensive.driveUrl, '_blank');
      materialsBtn.disabled = false;
      materialsBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      materialsBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i> 集中講義の資料';
    } else {
      materialsBtn.disabled = true;
      materialsBtn.classList.add('opacity-50', 'cursor-not-allowed');
      materialsBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i> 資料未設定';
    }
    return;
  }

  if (intensiveStatus === 'ended' && activeIntensive) {
    document.getElementById('now-subject').textContent = activeIntensive.title;
    document.getElementById('now-teacher').textContent =
      activeIntensive.teacher ? `担当：${activeIntensive.teacher} 師` : '';
    document.getElementById('live-badge').classList.add('hidden');
    document.getElementById('vacation-badge')?.classList.add('hidden');
    document.getElementById('intensive-ended-badge')?.classList.remove('hidden');
    document.getElementById('live-actions').classList.add('hidden');

    const hint = document.getElementById('off-hint');
    hint.innerHTML = `
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <span class="font-bold text-[#8b5a2b]">🎓 集中講義案内：</span>
          リアルタイムでの授業は終了しました。YouTubeをご覧ください。
        </div>
        <button onclick="navigate('intensive')"
                class="shrink-0 bg-[#8b5a2b] hover:bg-[#6b4422] text-white text-sm font-bold px-4 py-2 rounded-xl transition shadow">
          🎓 集中講義ページを見る ›
        </button>
      </div>`;
    hint.classList.remove('hidden');
    resetMaterialsBtn();
    return;
  }
  document.getElementById('intensive-ended-badge')?.classList.add('hidden');
  resetMaterialsBtn();

  // ② 休暇期間中
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

  // ③ 通常の時間割で今授業中か
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
      zoomBtn.onclick = () => window.open(active.zoomUrl, '_blank');
      zoomBtn.disabled = false;
      zoomBtn.innerHTML = '<i class="fa-solid fa-video"></i> Zoomで参加する';
    } else {
      zoomBtn.disabled = true;
      zoomBtn.innerHTML = 'Zoom URL 未設定';
      zoomBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
  }
}

// ==========================================
// 集中講義：専用ページ（案A：掲載中講義一覧表示）
// ==========================================
function renderIntensivePage(intensiveRaw) {
  const el = document.getElementById('intensive-detail');
  const publicList = getPublicIntensiveList(intensiveRaw);

  if (!publicList.length) {
    el.innerHTML = '<p class="text-gray-400">現在、集中講義の予定はありません。</p>';
    return;
  }

  el.innerHTML = `
    <div class="space-y-8">
      ${publicList.map(row => {
    const status = getIntensiveWindowStatus(row);
    const hasZoom = row.zoomUrl && String(row.zoomUrl).startsWith('http');
    const hasDrive = row.driveUrl && String(row.driveUrl).startsWith('http');
    const hasYoutube = row.youtubeUrl && String(row.youtubeUrl).startsWith('http');

    let zoomArea = '';
    if (status === 'live' && hasZoom) {
      zoomArea = `
            <a href="${row.zoomUrl}" target="_blank" rel="noopener"
               class="press flex items-center justify-center gap-2
                      bg-[#4a5d23] hover:bg-[#2c3614] text-white
                      p-4 rounded-xl font-bold text-lg transition shadow">
              <i class="fa-solid fa-video"></i> Zoomで参加する
            </a>`;
    } else if (status === 'before') {
      zoomArea = `
            <div class="flex items-center justify-center gap-2 bg-gray-100 text-gray-400
                        p-4 rounded-xl font-bold text-base border border-gray-200">
              <i class="fa-solid fa-video"></i> 開始30分前からZoom参加可能
            </div>`;
    } else if (status === 'ended') {
      zoomArea = `
            <div class="flex items-center justify-center gap-2 bg-gray-50 text-gray-500
                        p-4 rounded-xl text-sm border border-gray-200">
              <i class="fa-solid fa-check-circle"></i> リアルタイム授業は終了しました
            </div>`;
    }

    const driveArea = hasDrive ? `
          <a href="${row.driveUrl}" target="_blank" rel="noopener"
             class="press flex items-center justify-center gap-2
                    bg-[#8b5a2b] hover:bg-[#6b4422] text-white
                    p-4 rounded-xl font-bold text-lg transition shadow">
            <i class="fa-solid fa-folder-open"></i> 資料を見る
          </a>` : '';

    const youtubeArea = hasYoutube ? `
          <a href="${row.youtubeUrl}" target="_blank" rel="noopener"
             class="press flex items-center justify-center gap-2
                    bg-red-600 hover:bg-red-700 text-white
                    p-4 rounded-xl font-bold text-lg transition shadow">
            <i class="fa-brands fa-youtube"></i> YouTubeを見る
          </a>` : '';

    return `
          <div class="bg-white border-2 ${status === 'live' ? 'border-[#4a5d23] ring-4 ring-[#4a5d23]/10' : 'border-[#8b5a2b]/40'} rounded-3xl p-6 md:p-8 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
              ${row.period ? `<span class="bg-[#8b5a2b] text-white text-xs font-bold px-3 py-1 rounded-full">${formatPeriodDisplay(row.period)}</span>` : ''}
              ${status === 'live' ? '<span class="bg-red-600 text-white text-xs font-bold px-3 py-1 rounded-full blink">● 現在開講中</span>' : ''}
            </div>
            <h2 class="text-2xl md:text-3xl font-black text-[#2c3614] mb-2 leading-tight">${row.title}</h2>
            ${row.teacher ? `<p class="text-gray-600 font-bold mb-4">担当：${row.teacher} 師</p>` : ''}
            ${row.description ? `<p class="text-gray-700 leading-relaxed mb-6 whitespace-pre-wrap text-base">${row.description}</p>` : ''}
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              ${zoomArea}
              ${driveArea}
              ${youtubeArea}
            </div>
          </div>`;
  }).join('')}
    </div>`;
}



// ISO日付文字列 → 日本語表記（JST補正）
function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

function renderAnnouncements(data) {
  const el = document.getElementById('announcements-list');
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
  const pid = vacation ? null : currentPeriodId();

  const headerCells = DAYS.map(d => `
    <th class="border border-[#2c3614] p-3 text-sm min-w-[100px]
               ${d === today ? 'today-header' : ''}">${d}</th>
  `).join('');

  const bodyRows = PERIODS.map(p => {
    const cells = DAYS.map(d => {
      const cls = classAt(classes, p.id, d);
      const isToday = d === today;
      const isActive = isToday && pid === p.id;
      const tdCls = [
        'border border-gray-200 p-2 align-top text-center',
        isToday ? 'today-col' : '',
        isActive ? 'live-cell' : '',
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

      const hasZoom = cls.zoomUrl && String(cls.zoomUrl).startsWith('http');
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
              ${cls.note ? `<span class="text-xs text-gray-400 mt-0.5">${cls.note}</span>` : ''}
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
  const el = document.getElementById('materials-list');

  el.innerHTML = DAYS.map(day => {
    const isToday = day === today;
    const dayCls = classes.filter(c => c.day === day && c.period !== 'chapel');

    const cards = dayCls.map(cls => {
      const period = PERIODS.find(p => p.id === cls.period);
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
function renderArchives(data, intensiveRaw) {
  const el = document.getElementById('archives-list');

  const items = Array.isArray(data) ? [...data] : [];
  const list = Array.isArray(intensiveRaw) ? intensiveRaw : (intensiveRaw ? [intensiveRaw] : []);

  // アーカイブ済みの集中講義があれば先頭に合流させる
  list.forEach(row => {
    if (row && row.title && toBool(row.archived)) {
      items.unshift({
        subject: row.title,
        teacher: row.teacher,
        youtubeUrl: row.youtubeUrl,
        driveUrl: row.driveUrl,
        isIntensive: true,
      });
    }
  });

  if (!items.length) {
    el.innerHTML = '<p class="text-gray-400 col-span-3">動画はまだ登録されていません。</p>';
    return;
  }

  el.innerHTML = items.map(a => {
    const hasDrive = a.isIntensive && a.driveUrl && String(a.driveUrl).startsWith('http');
    return `
    <div class="bg-white border ${a.isIntensive ? 'border-[#8b5a2b] border-2' : 'border-gray-100'} rounded-2xl p-6 shadow-sm hover:shadow-md transition">
      <div class="bg-gray-100 h-28 rounded-xl flex items-center justify-center text-5xl mb-4">🎥</div>
      ${a.isIntensive ? '<span class="inline-block bg-[#8b5a2b] text-white text-[10px] font-bold px-2 py-0.5 rounded-full mb-2">🎓 集中講義</span>' : ''}
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
      ${hasDrive
        ? `<a href="${a.driveUrl}" target="_blank" rel="noopener"
              class="mt-2 flex items-center justify-center gap-2
                     bg-[#8b5a2b] hover:bg-[#6b4422] text-white py-3
                     rounded-xl font-bold transition">
             <i class="fa-solid fa-folder-open"></i> 資料を見る
           </a>`
        : ''
      }
    </div>`;
  }).join('');
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
  document.getElementById('now-time').textContent = '';
  document.getElementById('now-subject').textContent = '読み込み中...';
  document.getElementById('now-teacher').textContent = '';
  document.getElementById('off-hint').classList.add('hidden');
  document.getElementById('live-badge').classList.add('hidden');
  document.getElementById('live-actions').classList.add('hidden');

  // 全シートを並列取得（vacationsは休暇期間、intensiveは集中講義の登録用シート）
  const [classes, announcements, archives, vacations, intensiveRaw] = await Promise.all([
    fetchSheet('classes'),
    fetchSheet('announcements'),
    fetchSheet('archives'),
    fetchSheet('vacations'),
    fetchSheet('intensive'),
  ]);

  // 全セクション描画
  const activeVacation = getActiveVacation(vacations);
  renderLiveCard(classes, activeVacation, intensiveRaw);
  renderAnnouncements(announcements);
  renderTimetable(classes, activeVacation);
  renderArchives(archives, intensiveRaw);
  renderIntensivePage(intensiveRaw);

  // 1分ごとにライブ状態を更新（休暇・集中講義とも日時をまたぐ切り替えに追随させる）
  setInterval(() => {
    const vac = getActiveVacation(vacations);
    renderLiveCard(classes, vac, intensiveRaw);
    renderTimetable(classes, vac);
    renderIntensivePage(intensiveRaw);
  }, 60 * 1000);

  navigate('home');
}

document.addEventListener('DOMContentLoaded', init);