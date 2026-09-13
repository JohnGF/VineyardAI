let expertMode = false;
let currentLang = 'pt-PT';

// Core Data Schema in LocalStorage
const STORAGE_KEY = 'adega_facil_batches_v1';
const SETTINGS_KEY = 'adega_facil_settings_v1';
let batches = [];
let currentBatchId = null;
let appSettings = {
  autoEstimateVolume: true,
  directWeighingMode: false
};

// Weighing Tool State
let basketLogs = [];

function initApp() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { batches = JSON.parse(saved); } catch(e) { batches = []; }
  }

  const savedSettings = localStorage.getItem(SETTINGS_KEY);
  if (savedSettings) {
    try { appSettings = { ...appSettings, ...JSON.parse(savedSettings) }; } catch(e) {}
  }

  document.getElementById('toggle-est-vol').checked = appSettings.autoEstimateVolume;
  const toggleDirect = document.getElementById('toggle-direct-weighing');
  if (toggleDirect) toggleDirect.checked = appSettings.directWeighingMode;

  if (batches && batches.length > 0 && !currentBatchId) {
    currentBatchId = batches[0].id;
  }

  applyTranslations();
  renderBatchSelect();
  updateDashboard();
  calculateSO2();
}

function saveBatches() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(appSettings));
}

function toggleEstimateVolumeSetting(isChecked) {
  appSettings.autoEstimateVolume = isChecked;
  saveSettings();
}

function toggleDirectWeighingSetting(isChecked) {
  appSettings.directWeighingMode = isChecked;
  saveSettings();
  updateDashboard();
}

function getActiveBatch() {
  if (!batches || batches.length === 0) return null;
  return batches.find(b => b.id === currentBatchId) || batches[0];
}

// Mathematical calculations
function calculateCorrectedSG(rawSG, tempC) {
  const deltaT = tempC - 20;
  return rawSG + (1.31e-4 * deltaT) + (2.45e-5 * Math.pow(deltaT, 2));
}

function calculateABV(initialSG, currentSG) {
  if (currentSG >= initialSG) return 0.0;
  return ((initialSG - currentSG) * 131.25).toFixed(1);
}

// Timeline Calculations
function calculateTimeline(batch, currentSG, logs) {
  const startDate = new Date(batch.startDate || batch.createdAt);

  const tl = {
    crush: startDate.toLocaleDateString(currentLang, {day:'2-digit', month:'short'}),
    press: '--',
    rack: '--',
    progress: 0,
    activeStep: 0
  };

  // Recalibrate based on logs
  if (logs.length > 1 && currentSG < batch.initialSG) {
    // Calculate daily drop rate
    const firstLog = logs[0];
    const lastLog = logs[logs.length-1];

    // Use parseable dates if possible, else just assume 1 day between logs roughly if same date
    const t1 = new Date(batch.startDate || batch.createdAt).getTime();

    // Simple heuristic: 0.010 drop per day average if no clear time deltas
    const daysPassed = Math.max(1, (new Date().getTime() - t1) / (1000 * 3600 * 24));
    const totalDrop = batch.initialSG - currentSG;
    const ratePerDay = totalDrop / daysPassed;

    if (ratePerDay > 0) {
      const targetPressSG = batch.style === 'palhete' ? 1.030 : 0.998;
      if (currentSG > targetPressSG) {
        const daysToPress = (currentSG - targetPressSG) / ratePerDay;
        const estPressDate = new Date();
        estPressDate.setDate(estPressDate.getDate() + daysToPress);
        tl.press = estPressDate.toLocaleDateString(currentLang, {day:'2-digit', month:'short'});
        tl.activeStep = 1; // Fermenting
        tl.progress = 25 + (35 * ((batch.initialSG - currentSG) / (batch.initialSG - targetPressSG)));
      } else {
        tl.press = 'Feito';
        tl.activeStep = 2; // Pressed
        tl.progress = 65;

        // Est rack date 14 days after pressing
        if (currentSG <= 0.998) {
           const rackDate = new Date();
           rackDate.setDate(rackDate.getDate() + 14);
           tl.rack = rackDate.toLocaleDateString(currentLang, {day:'2-digit', month:'short'});
           tl.progress = 85;
        }
      }
    }
  } else {
    // Fallbacks
    const pDate = new Date(startDate);
    pDate.setDate(pDate.getDate() + (batch.style === 'palhete' ? 3 : 7));
    tl.press = pDate.toLocaleDateString(currentLang, {day:'2-digit', month:'short'});
    tl.activeStep = 1;
    tl.progress = 25;
  }

  if (currentSG <= 0.995) {
    tl.activeStep = 3; // Racking time
    tl.progress = 100;
    tl.rack = 'Feito';
  }

  return tl;
}

function renderTimeline(batch, currentSG, logs) {
  const container = document.getElementById('timeline-points');
  if (!container) return;

  const t = i18n[currentLang];
  const tl = calculateTimeline(batch, currentSG, logs);

  const steps = [
    { icon: '🍇', label: t.timeline_crush, date: tl.crush, active: tl.activeStep >= 0 },
    { icon: '🫧', label: t.timeline_ferment, date: tl.activeStep === 1 ? 'Agora' : '', active: tl.activeStep >= 1 },
    { icon: '🧺', label: t.timeline_press, date: tl.press, active: tl.activeStep >= 2 },
    { icon: '🍷', label: t.timeline_rack, date: tl.rack, active: tl.activeStep >= 3 }
  ];

  container.innerHTML = steps.map((s, i) => `
    <div class="flex flex-col items-center group">
      <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-sm transition-all duration-300 ${
        s.active
          ? (i === tl.activeStep ? 'bg-wine-700 text-white ring-4 ring-wine-700/20 scale-110' : 'bg-wine-800 text-white')
          : 'bg-stone-100 text-stone-400 border-2 border-stone-200'
      }">
        ${s.icon}
      </div>
      <span class="text-[10px] font-bold mt-1.5 ${i === tl.activeStep ? 'text-wine-700' : (s.active ? 'text-stone-700' : 'text-stone-400')}">${s.label}</span>
      <span class="text-[9px] text-stone-400 mt-0.5">${s.date}</span>
    </div>
  `).join('');
}

function handleSO2Log(e) {
  e.preventDefault();
  const batch = getActiveBatch();
  if (!batch) return;

  const free = parseFloat(document.getElementById('input-so2-free').value);
  if (!batch.so2Logs) batch.so2Logs = [];

  batch.so2Logs.push({
    date: new Date().toLocaleDateString(currentLang),
    free: free
  });

  saveBatches();
  document.getElementById('input-so2-free').value = '';
  updateDashboard();
}

function renderSO2History(batch) {
  const container = document.getElementById('so2-tracker-list');
  if (!container) return;

  if (!batch.so2Logs || batch.so2Logs.length === 0) {
    container.innerHTML = '<p class="text-stone-400 py-2 italic text-center text-[11px]" data-i18n="no_so2_logs">' + (i18n[currentLang].no_so2_logs) + '</p>';
    return;
  }

  container.innerHTML = [...batch.so2Logs].reverse().map(l => `
    <div class="py-2 flex justify-between items-center">
      <span class="text-stone-400">${l.date}</span>
      <span class="font-bold ${l.free >= 30 ? 'text-emerald-600' : 'text-stone-800'}">${l.free} mg/L ${l.free >= 30 ? '✅' : ''}</span>
    </div>
  `).join('');
}

    function handleMLFLog(e) {
  e.preventDefault();
  const batch = getActiveBatch();
  if (!batch) return;

  const malic = parseFloat(document.getElementById('input-mlf').value);
  if (!batch.mlfLogs) batch.mlfLogs = [];

  batch.mlfLogs.push({
    date: new Date().toLocaleDateString(currentLang),
    malic: malic
  });

  saveBatches();
  document.getElementById('input-mlf').value = '';
  updateDashboard();
}

function renderMLFHistory(batch) {
  const container = document.getElementById('mlf-list');
  if (!container) return;

  if (!batch.mlfLogs || batch.mlfLogs.length === 0) {
    container.innerHTML = '<p class="text-stone-400 py-2 italic text-center text-[11px]" data-i18n="no_mlf_logs">' + (i18n[currentLang].no_mlf_logs) + '</p>';
    return;
  }

  container.innerHTML = [...batch.mlfLogs].reverse().map(l => `
    <div class="py-2 flex justify-between items-center">
      <span class="text-stone-400">${l.date}</span>
      <span class="font-bold ${l.malic <= 0.3 ? 'text-emerald-600' : 'text-stone-800'}">${l.malic.toFixed(1)} g/L ${l.malic <= 0.3 ? '✅' : ''}</span>
    </div>
  `).join('');
}

// UI Updates
function updateDashboard() {
  const batch = getActiveBatch();

  const tabMonitor = document.getElementById('tab-monitor');
  let emptyState = document.getElementById('empty-state');
  const currentActiveTab = ['monitor', 'calculator', 'vintages', 'settings'].find(t => !document.getElementById(`tab-${t}`).classList.contains('hidden')) || 'monitor';

  if (!batch) {
    if (!emptyState) {
      const emptyDiv = document.createElement('div');
      emptyDiv.id = 'empty-state';
      emptyDiv.className = 'bg-cellar-card rounded-2xl p-8 border border-cellar-border shadow-sm text-center space-y-4';
      emptyDiv.innerHTML = `
        <div class="text-4xl mb-2">🍇</div>
        <h2 class="text-xl font-bold text-stone-900" data-i18n="empty_title">Bem-vindo à Adega Fácil</h2>
        <p class="text-sm text-stone-500" data-i18n="empty_desc">Comece por criar a sua primeira cuba para registar a vindima.</p>
        <button onclick="openNewBatchModal()" class="mt-4 bg-wine-700 hover:bg-wine-800 text-white font-bold py-3 px-6 rounded-xl shadow transition text-sm inline-flex items-center gap-2">
          + <span data-i18n="new_batch">Nova Cuba</span>
        </button>
      `;
      tabMonitor.parentNode.insertBefore(emptyDiv, tabMonitor);
      emptyState = emptyDiv;
    }

    if (currentActiveTab === 'monitor') {
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
    }
    tabMonitor.classList.add('hidden');
    applyTranslations();

  const directBtn = document.getElementById('direct-weighing-btn-container');
  if (directBtn) {
    if (appSettings.directWeighingMode && currentActiveTab === 'monitor') {
      directBtn.classList.remove('hidden');
    } else {
      directBtn.classList.add('hidden');
    }
  }

    return;
  } else {
    if (emptyState) emptyState.classList.add('hidden');
    if (currentActiveTab === 'monitor') {
      tabMonitor.classList.remove('hidden');
    }

    const directBtn = document.getElementById('direct-weighing-btn-container');
    if (directBtn) {
      if (appSettings.directWeighingMode && currentActiveTab === 'monitor') {
        directBtn.classList.remove('hidden');
      } else {
        directBtn.classList.add('hidden');
      }
    }
  }

  const latestLog = batch.logs && batch.logs.length > 0 ? batch.logs[batch.logs.length - 1] : null;
  const currentSG = latestLog ? latestLog.sg : batch.initialSG;

  // Timeline
  renderTimeline(batch, currentSG, batch.logs || []);

  // Stats
  document.getElementById('stat-sg').innerText = currentSG.toFixed(3);
  if (latestLog) {
    document.getElementById('stat-sg-date').innerText = latestLog.date;
  }

  const abv = calculateABV(batch.initialSG, currentSG);
  document.getElementById('stat-abv').innerText = abv + '%';
  const potentialTotal = ((batch.initialSG - 0.994) * 131.25).toFixed(1);
  document.getElementById('stat-abv-target').innerText = `Alvo final: ~${potentialTotal}%`;

  // Cellar Logic Action Decision
  renderCellarAction(batch, currentSG);

  // Render Logs
  renderLogHistory(batch);
  renderMLFHistory(batch);
  renderSO2History(batch);

  // Render Archival/Vintages tab
  renderVintagesList();
}

function renderCellarAction(batch, sg) {
  const box = document.getElementById('action-box');
  const t = i18n[currentLang];

  if (batch.style === 'palhete' && sg <= 1.050 && sg >= 1.020) {
    // Critical Palhete Pressing Window
    box.className = 'rounded-2xl p-5 border shadow-sm bg-rose-600 text-white border-rose-700 animate-pulse';
    box.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="text-3xl">🧺</span>
        <div>
          <h3 class="font-black text-base tracking-wide">${t.action_ready_press_title}</h3>
          <p class="text-xs text-rose-100 mt-1 leading-relaxed">${t.action_ready_press_palhete}</p>
        </div>
      </div>
    `;
  } else if (sg > 1.010) {
    // Active Fermentation
    box.className = 'rounded-2xl p-5 border shadow-sm bg-amber-500/10 border-amber-500/30 text-stone-900';
    box.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="text-3xl">🫧</span>
        <div>
          <h3 class="font-bold text-amber-900 text-sm tracking-wide">${t.action_active_title}</h3>
          <p class="text-xs text-stone-700 mt-1 leading-relaxed">${t.action_active_desc}</p>
        </div>
      </div>
    `;
  } else {
    // Complete / Dry
    box.className = 'rounded-2xl p-5 border shadow-sm bg-emerald-500/10 border-emerald-500/30 text-stone-900';
    box.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="text-3xl">🍾</span>
        <div>
          <h3 class="font-bold text-emerald-900 text-sm tracking-wide">${t.action_dry_title}</h3>
          <p class="text-xs text-stone-700 mt-1 leading-relaxed">${t.action_dry_desc}</p>
        </div>
      </div>
    `;
  }
}

function renderLogHistory(batch) {
  const container = document.getElementById('log-list');
  if (!batch.logs || batch.logs.length === 0) {
    container.innerHTML = `<p class="text-xs text-stone-400 py-3 text-center">Sem medições registadas.</p>`;
    return;
  }

  container.innerHTML = [...batch.logs].reverse().map(l => `
    <div class="py-2.5 flex justify-between items-center text-sm">
      <div>
        <div class="font-bold text-stone-800">${l.sg.toFixed(3)} <span class="text-xs font-normal text-stone-500">(${l.temp}°C)</span></div>
        <div class="text-[11px] text-stone-400">${l.date}</div>
      </div>
      <div>
        ${l.punched ? '<span class="text-[10px] bg-wine-700/10 text-wine-800 font-bold px-2 py-0.5 rounded-full">Pisado</span>' : ''}
      </div>
    </div>
  `).join('');
}

function handleNewLog(e) {
  e.preventDefault();
  const rawSG = parseFloat(document.getElementById('input-sg').value);
  const temp = parseFloat(document.getElementById('input-temp').value) || 20;
  const punched = document.getElementById('check-plunge').checked;

  const correctedSG = calculateCorrectedSG(rawSG, temp);
  const batch = getActiveBatch();

  const newEntry = {
    date: new Date().toLocaleDateString(currentLang) + ' ' + new Date().toLocaleTimeString(currentLang, {hour:'2-digit', minute:'2-digit'}),
    sg: parseFloat(correctedSG.toFixed(3)),
    temp: temp,
    punched: punched
  };

  batch.logs.push(newEntry);
  saveBatches();
  document.getElementById('input-sg').value = '';
  document.getElementById('check-plunge').checked = false;
  updateDashboard();
}

// Calculators
function calculateSO2() {
  const batch = getActiveBatch();
  const vol = batch ? batch.volumeLiters : 80;
  const targetPPM = parseFloat(document.getElementById('calc-so2-target').value) || 35;

  // grams = (Volume * ppm) / 576
  const gramsKMBS = (vol * targetPPM) / 576;
  document.getElementById('so2-result').innerText = gramsKMBS.toFixed(1) + ' g';

  // 1 campden tablet provides ~0.44g SO2 => roughly equivalent
  const tablets = (gramsKMBS / 0.88).toFixed(1);
  document.getElementById('so2-campden-eq').innerText = `ou ~${tablets} pastilhas Campden esmagadas (para ${vol} L)`;
}
if (document.getElementById('calc-so2-target')) {
    document.getElementById('calc-so2-target').addEventListener('change', calculateSO2);
}

function calculateSugar() {
  const batch = getActiveBatch();
  const vol = batch ? batch.volumeLiters : 80;
  const b1 = parseFloat(document.getElementById('calc-brix-curr').value);
  const b2 = parseFloat(document.getElementById('calc-brix-target').value);

  if (b2 <= b1) return;
  // Mass sugar (kg) = (V * (B2 - B1)) / (100 - B2)
  const kgSugar = (vol * (b2 - b1)) / (100 - b2);
  document.getElementById('sugar-result').innerText = kgSugar.toFixed(2) + ' kg';
  document.getElementById('sugar-result-box').classList.remove('hidden');
}

function calculateDAP() {
  const batch = getActiveBatch();
  const vol = batch ? batch.volumeLiters : 100;
  const target = parseFloat(document.getElementById('calc-dap-target').value);
  const current = parseFloat(document.getElementById('calc-dap-curr').value);

  if (target <= current) return;
  const deficit = target - current;
  // DAP provides approx 212ppm YAN per 1g/L (which is 1g/L = 212ppm).
  // g/L needed = deficit / 212
  const gPerL = deficit / 212;
  const totalGrams = gPerL * vol;

  document.getElementById('dap-result').innerText = totalGrams.toFixed(1) + ' g';
  document.getElementById('dap-result-box').classList.remove('hidden');
}

function calculateYAN() {
  const batch = getActiveBatch();
  const vol = batch ? batch.volumeLiters : 100;
  const target = parseFloat(document.getElementById('calc-yan-target').value);
  const current = parseFloat(document.getElementById('calc-yan-curr').value);

  if (target <= current) return;
  const deficit = target - current;
  // Fermaid O provides roughly 40ppm YAN per 10g/hL (which is 10g/100L = 0.1g/L)
  // So 1g/L Fermaid O gives 400ppm YAN.
  // g/L needed = deficit / 400
  const gPerL = deficit / 400;
  const totalGrams = gPerL * vol;

  document.getElementById('yan-result').innerText = totalGrams.toFixed(1) + ' g';
  document.getElementById('yan-result-box').classList.remove('hidden');
}

function calculateAcidity() {
  const batch = getActiveBatch();
  const vol = batch ? batch.volumeLiters : 100;
  const inc = parseFloat(document.getElementById('calc-acid-inc').value);

  if (inc <= 0) return;
  // 1 g/L of Tartaric acid increases TA by 1 g/L.
  const totalGrams = inc * vol;

  document.getElementById('acid-result').innerText = totalGrams.toFixed(1) + ' g';
  document.getElementById('acid-result-box').classList.remove('hidden');
}

// Export Data
function exportToCSV() {
  if (!batches || batches.length === 0) return;

  const sep = ',';
  let csvContent = 'data:text/csv;charset=utf-8,\uFEFF'; // Added BOM for Excel UTF-8 support

  // Header
  csvContent += ['Nome', 'Ano', 'Data Inicio', 'Estilo', 'Uvas (Kg)', 'Volume (L)', 'Densidade Inicial', 'Densidade Final', 'Nota (1-5)', 'Revisão Taninos', 'Revisão Acidez', 'Notas'].join(sep) + '\n';

  batches.forEach(b => {
    const d_name = `"${(b.name || '').replace(/"/g, '""')}"`;
    const d_year = b.year || '';
    const d_start = b.startDate ? new Date(b.startDate).toLocaleDateString() : '';
    const d_style = b.style || '';
    const d_kilos = b.kilos || '';
    const d_vol = b.volumeLiters || '';
    const d_initialSG = b.initialSG || '';
    const d_finalSG = (b.logs && b.logs.length > 0) ? b.logs[b.logs.length-1].sg : '';

    let d_score = '', d_tannin = '', d_acid = '', d_notes = '';
    if (b.review) {
      d_score = b.review.score || '';
      d_tannin = b.review.tannin || '';
      d_acid = b.review.acid || '';
      d_notes = `"${(b.review.notes || '').replace(/"/g, '""')}"`;
    }

    const row = [d_name, d_year, d_start, d_style, d_kilos, d_vol, d_initialSG, d_finalSG, d_score, d_tannin, d_acid, d_notes].join(sep);
    csvContent += row + '\n';
  });

  // Use Blob to avoid URL fragment issues with hashes (#) in notes or names
  const csvData = csvContent.replace('data:text/csv;charset=utf-8,', '');
  const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `adega_facil_export_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Retro / Archive
function handleSaveRetro(e) {
  e.preventDefault();
  const batch = getActiveBatch();
  batch.review = {
    score: document.getElementById('retro-score').value,
    tannin: document.getElementById('retro-tannin').value,
    acid: document.getElementById('retro-acid').value,
    notes: document.getElementById('retro-notes').value,
    date: new Date().toLocaleDateString(currentLang)
  };
  saveBatches();
  renderVintagesList();
  alert('Memória gravada com sucesso!');
}

function renderVintagesList() {
  const container = document.getElementById('vintages-list');
  container.innerHTML = batches.map(b => `
    <div class="bg-cellar-card rounded-xl p-4 border border-cellar-border shadow-sm">
      <div class="flex justify-between items-start">
        <div>
          <h4 class="font-bold text-stone-900">${b.name}</h4>
          <span class="text-xs text-stone-500">${b.volumeLiters} Litros • Estilo: ${b.style}</span>
        </div>
        <span class="text-sm font-bold text-wine-700">${b.review ? '⭐ ' + b.review.score + '/5' : 'Em curso'}</span>
      </div>
      ${b.review ? `
        <div class="mt-2 text-xs bg-stone-50 p-2.5 rounded-lg border border-stone-200 text-stone-700">
          <p class="font-semibold">Notas para o próximo ano:</p>
          <p class="italic mt-0.5">"${b.review.notes || 'Sem observações adicionais.'}"</p>
        </div>
      ` : ''}
    </div>
  `).join('');
}

// Batch Management
function deleteCurrentBatch() {
  if (!currentBatchId) return;
  if (!confirm(i18n[currentLang].confirm_delete_batch)) return;

  batches = batches.filter(b => b.id !== currentBatchId);
  currentBatchId = batches.length > 0 ? batches[0].id : null;
  saveBatches();
  renderBatchSelect();
  updateDashboard();
  calculateSO2();
}

function renderBatchSelect() {
  const sel = document.getElementById('batch-select');
  if (!batches || batches.length === 0) {
    sel.innerHTML = `<option value="" disabled selected>${i18n[currentLang].no_batches || 'Nenhuma Cuba'}</option>`;
  } else {
    sel.innerHTML = batches.map(b => `
      <option value="${b.id}" ${b.id === currentBatchId ? 'selected' : ''}>${b.name} (${b.volumeLiters}L)</option>
    `).join('');
  }
}

function switchBatch(id) {
  currentBatchId = id;
  updateDashboard();
  calculateSO2();
}

function openNewBatchModal() {
  document.getElementById('new-batch-date').valueAsDate = new Date();
  document.getElementById('modal-batch').classList.remove('hidden');
}
function closeNewBatchModal() { document.getElementById('modal-batch').classList.add('hidden'); }

// Weighing Tool Logic
function openWeighingTool(isDirect) {
  basketLogs = [];
  document.getElementById('weigh-gross').value = '';
  document.getElementById('modal-weigh').classList.remove('hidden');
  updateCurrentNet();
  renderBasketLogs();

  if (isDirect) {
    document.getElementById('modal-batch').classList.add('hidden');
  }
}

function closeWeighingTool() {
  document.getElementById('modal-weigh').classList.add('hidden');
}

function updateCurrentNet() {
  const tare = parseFloat(document.getElementById('weigh-tare').value) || 0;
  const gross = parseFloat(document.getElementById('weigh-gross').value) || 0;
  let net = gross - tare;
  if (net < 0) net = 0;
  document.getElementById('weigh-current-net').innerText = net.toFixed(1);
}

function handleWeighKeyPress(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    addBasketWeight();
  }
}

function addBasketWeight() {
  const tare = parseFloat(document.getElementById('weigh-tare').value) || 0;
  const gross = parseFloat(document.getElementById('weigh-gross').value) || 0;

  if (gross <= tare) {
    alert(currentLang === 'pt-PT' ? 'O peso bruto deve ser maior que a tara.' : 'Gross weight must be greater than tare.');
    return;
  }

  const net = parseFloat((gross - tare).toFixed(1));
  basketLogs.push({ gross, tare, net });

  document.getElementById('weigh-gross').value = '';
  document.getElementById('weigh-gross').focus();
  updateCurrentNet();
  renderBasketLogs();
}

function removeBasketWeight(index) {
  basketLogs.splice(index, 1);
  renderBasketLogs();
}

function renderBasketLogs() {
  const list = document.getElementById('weigh-list');
  const totalEl = document.getElementById('weigh-total');

  if (basketLogs.length === 0) {
    list.innerHTML = `<p class="text-xs text-stone-400 py-4 text-center italic" data-i18n="no_baskets_yet">${currentLang === 'pt-PT' ? 'Nenhuma cesta adicionada.' : 'No baskets added yet.'}</p>`;
    totalEl.innerHTML = `0.0 <span class="text-lg">Kg</span>`;
    return;
  }

  let totalNet = 0;
  list.innerHTML = basketLogs.map((b, i) => {
    totalNet += b.net;
    return `
      <div class="flex justify-between items-center bg-white p-2 rounded-lg border border-stone-200 shadow-sm text-sm">
        <div>
          <span class="font-bold text-stone-800">${b.net.toFixed(1)} Kg</span>
          <span class="text-[10px] text-stone-500 ml-1">(Bruto: ${b.gross.toFixed(1)})</span>
        </div>
        <button onclick="removeBasketWeight(${i})" class="text-red-500 hover:bg-red-50 p-1 rounded transition" title="Remover">🗑️</button>
      </div>
    `;
  }).reverse().join('');

  totalEl.innerHTML = `${totalNet.toFixed(1)} <span class="text-lg">Kg</span>`;
}

function applyTotalWeight() {
  const totalNet = basketLogs.reduce((sum, b) => sum + b.net, 0);

  // Open modal if closed
  document.getElementById('modal-batch').classList.remove('hidden');

  // Set value and trigger estimation
  const kilosInput = document.getElementById('new-batch-kilos');
  kilosInput.value = totalNet > 0 ? totalNet.toFixed(1) : '';
  estimateVolume();

  closeWeighingTool();
}

function estimateVolume() {
  if (!appSettings.autoEstimateVolume) return;
  const kilos = parseFloat(document.getElementById('new-batch-kilos').value) || 0;
  if (kilos > 0) {
    // Rough estimate: 70 liters per 100 kg
    document.getElementById('new-batch-vol').value = Math.round(kilos * 0.7);
  }
}

function handleCreateBatch(e) {
  e.preventDefault();
  const startDateStr = document.getElementById('new-batch-date').value;
  const startDate = startDateStr ? new Date(startDateStr) : new Date();

  const newB = {
    id: 'batch-' + Date.now(),
    name: document.getElementById('new-batch-name').value,
    year: startDate.getFullYear(),
    kilos: parseFloat(document.getElementById('new-batch-kilos').value) || null,
    volumeLiters: parseFloat(document.getElementById('new-batch-vol').value) || 50,
    initialSG: parseFloat(document.getElementById('new-batch-sg').value) || 1.090,
    style: document.getElementById('new-batch-style').value,
    createdAt: startDate.toISOString(),
    logs: [
      { date: startDate.toLocaleDateString(currentLang), sg: parseFloat(document.getElementById('new-batch-sg').value) || 1.090, temp: 20, punched: true }
    ],
    review: null,
    startDate: startDate.toISOString()
  };

  batches.unshift(newB);
  currentBatchId = newB.id;
  saveBatches();
  closeNewBatchModal();
  renderBatchSelect();
  updateDashboard();
  calculateSO2();
}

// Navigation & Tabs
function changeTab(tabId) {
  const batch = getActiveBatch();
  const emptyState = document.getElementById('empty-state');
  const directBtn = document.getElementById('direct-weighing-btn-container');

  ['monitor', 'calculator', 'vintages', 'settings'].forEach(t => {
    const tabEl = document.getElementById(`tab-${t}`);
    if (t === tabId) {
        // Only show tab if there's a batch, or if we're not on monitor tab
        if (batch || t !== 'monitor') {
           tabEl.classList.remove('hidden');
        } else {
           tabEl.classList.add('hidden');
        }
    } else {
        tabEl.classList.add('hidden');
    }
    const navBtn = document.getElementById(`nav-${t}`);
    if (t === tabId) {
      navBtn.className = 'flex flex-col items-center text-wine-700 font-bold py-1';
    } else {
      navBtn.className = 'flex flex-col items-center text-stone-400 hover:text-stone-700 font-medium py-1';
    }
  });

  if (!batch && emptyState) {
      if (tabId === 'monitor') {
          emptyState.classList.remove('hidden');
      } else {
          emptyState.classList.add('hidden');
      }
  }

  if (directBtn) {
    if (appSettings.directWeighingMode && tabId === 'monitor') {
      directBtn.classList.remove('hidden');
    } else {
      directBtn.classList.add('hidden');
    }
  }
}

// Translation toggle
function toggleExpertMode() {
  expertMode = !expertMode;
  const btnText = document.getElementById('expert-btn');
  const btnParent = btnText.parentElement;

  if (expertMode) {
    btnText.innerHTML = `🔬 <span data-i18n="expert_mode_on">${i18n[currentLang].expert_mode_on}</span>`;
    btnParent.classList.remove('bg-stone-700/60', 'text-stone-200', 'border-stone-400/30');
    btnParent.classList.add('bg-amber-600/80', 'text-white', 'border-amber-400/50');
  } else {
    btnText.innerHTML = `🧪 <span data-i18n="expert_mode_off">${i18n[currentLang].expert_mode_off}</span>`;
    btnParent.classList.remove('bg-amber-600/80', 'text-white', 'border-amber-400/50');
    btnParent.classList.add('bg-stone-700/60', 'text-stone-200', 'border-stone-400/30');
  }

  applyTranslations();

  // Update visibility of expert features
  document.querySelectorAll('.expert-feature').forEach(el => {
    if (expertMode) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
}

function toggleLang() {
  currentLang = currentLang === 'pt-PT' ? 'en' : 'pt-PT';
  document.getElementById('lang-btn').innerText = currentLang === 'pt-PT' ? 'EN' : 'PT';
  applyTranslations();
  updateDashboard();
}

function applyTranslations() {
  const dict = i18n[currentLang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.innerText = dict[key];
  });
  document.getElementById('app-subtitle').innerText = currentLang === 'pt-PT' ? 'Controlo de Fermentação & Prensagem' : 'Fermentation & Press Monitor';
}

// Init
window.addEventListener('DOMContentLoaded', initApp);
