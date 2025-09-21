// Simple attendance taker
// Data model saved in localStorage under key: "attendance:data"

const STORAGE_KEY = 'attendance:data';

let state = loadState();
// Seed user if no auth present (one-time)
state.auth = state.auth || { users: {}, currentUser: null };
if(Object.keys(state.auth.users).length === 0){
  // seeded user provided by workspace owner: username 2501, password 221029
  state.auth.users['A2501'] = { username: 'A2501', passwordHash: simpleHash('221029') };
  // additional seeded user requested: username 2502, password 221029
  state.auth.users['2502'] = { username: '2502', passwordHash: simpleHash('221029') };
  saveState();
}
// state.auth: { users: { username: { username, passwordHash } }, currentUser: null }

// DOM refs
const eventList = document.getElementById('eventList');
const addEventBtn = document.getElementById('addEvent');
const eventNameInput = document.getElementById('eventName');
// const renameEventBtn = document.getElementById('renameEvent');
const deleteEventBtn = document.getElementById('deleteEvent');

const memberNameInput = document.getElementById('memberName');
const memberIdInput = document.getElementById('memberId');
const addMemberBtn = document.getElementById('addMember');
const membersTableBody = document.querySelector('#membersTable tbody');
const exportCsvBtn = document.getElementById('exportCsv');
const importCsvInput = document.getElementById('importCsv');
const clearAllBtn = document.getElementById('clearAll');
const authSection = document.getElementById('authSection');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const btnLogin = document.getElementById('btnLogin');
const btnLogout = document.getElementById('btnLogout');
const authMessage = document.getElementById('authMessage');
const appContent = document.getElementById('appContent');
const showPastEventsBtn = document.getElementById('showPastEvents');

// Initialize
renderEventOptions();
attachHandlers();
renderMembersTable();
updateAuthUI();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return { events: {}, members: {} , selectedEventId: null };
    return JSON.parse(raw);
  }catch(e){
    console.error('Failed to parse stored state', e);
    return { events: {}, members: {} , selectedEventId: null };
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid(prefix='E'){
  return prefix + Math.random().toString(36).slice(2,9).toUpperCase();
}

function simpleHash(s){
  // very small non-cryptographic hash (for demo only)
  let h = 2166136261 >>> 0;
  for(let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

function attachHandlers(){
  addEventBtn.addEventListener('click', () => {
    if(!requireAuth()) return;
    const name = eventNameInput.value.trim();
    if(!name) return alert('Enter an event name');
    const id = uid('E');
    state.events[id] = { id, name, attendance: {}, createdAt: Date.now() };
    state.selectedEventId = id;
    saveState();
    eventNameInput.value = '';
    renderEventOptions();
    renderMembersTable();
  });

  eventList.addEventListener('change', () => {
    state.selectedEventId = eventList.value || null;
    saveState();
    renderMembersTable();
  });

//   renameEventBtn.addEventListener('click', () => {
//     if(!requireAuth()) return;
//     const id = state.selectedEventId;
//     if(!id) return alert('Select an event');
//     const newName = prompt('New event name', state.events[id].name);
//     if(!newName) return;
//     state.events[id].name = newName.trim();
//     saveState();
//     renderEventOptions();
//   });

  deleteEventBtn.addEventListener('click', () => {
    if(!requireAuth()) return;
    const id = state.selectedEventId;
    if(!id) return alert('Select an event');
    if(!confirm('Delete event "' + state.events[id].name + '"? This will not delete members but will delete attendance records for this event.')) return;
    delete state.events[id];
    state.selectedEventId = Object.keys(state.events)[0] || null;
    saveState();
    renderEventOptions();
    renderMembersTable();
  });

  addMemberBtn.addEventListener('click', () => {
    const name = memberNameInput.value.trim();
    let id = memberIdInput.value.trim();
    if(!name || !id) return alert('Provide both name and unique ID');
    // normalize ID to uppercase and check duplicates case-insensitively
    id = id.toUpperCase();
    if(Object.keys(state.members).some(mid => mid.toUpperCase() === id)) return alert('Member ID already exists');
    state.members[id] = { id, name };
    // ensure each event has attendance default false
    Object.values(state.events).forEach(ev => ev.attendance[id] = false);
    saveState();
    memberNameInput.value = '';
    memberIdInput.value = '';
    renderMembersTable();
    renderEventOptions();
  });

  exportCsvBtn.addEventListener('click', () => {
    if(!requireAuth()) return;
    const csv = buildCsv();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (state.selectedEventId ? state.events[state.selectedEventId].name : 'attendance') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  clearAllBtn.addEventListener('click', () => {
    if(!requireAuth()) return;
    if(!confirm('Clear all data in localStorage for this app?')) return;
    state = { events: {}, members: {}, selectedEventId: null, auth: { users: {}, currentUser: null } };
    saveState();
    renderEventOptions();
    renderMembersTable();
  });

  // CSV import handler
  if(importCsvInput){
    importCsvInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if(!f) return;
      if(!requireAuth()) return;
      const reader = new FileReader();
      reader.onload = () => {
        const txt = String(reader.result || '');
        const lines = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
        if(lines.length === 0) return alert('Empty file');
        // support header: ID,Name or Name,ID - detect
        const headerParts = lines[0].split(',').map(s=>s.trim().toLowerCase());
        let hasHeader = false;
        let idIndex = 0, nameIndex = 1;
        if(headerParts.includes('id') || headerParts.includes('name')){
          hasHeader = true;
          idIndex = headerParts.indexOf('id') >= 0 ? headerParts.indexOf('id') : 0;
          nameIndex = headerParts.indexOf('name') >= 0 ? headerParts.indexOf('name') : (idIndex === 0 ? 1 : 0);
        }
        const rows = hasHeader ? lines.slice(1) : lines;
        let added = 0, skipped = 0, dup = 0;
        rows.forEach(line => {
          // simple CSV split by comma, support quoted names
          const parts = line.match(/(?:\s*"([^"]*)"\s*|\s*([^,]+)\s*)(?:,|$)/g);
          let cols = [];
          if(parts){
            cols = parts.map(p => p.replace(/^\s*"|"\s*$|\s*$/g,''));
          } else {
            cols = line.split(',').map(s=>s.trim());
          }
          const rawId = (cols[idIndex] || '').trim();
          const rawName = (cols[nameIndex] || '').trim();
          if(!rawId || !rawName){ skipped++; return; }
          const id = rawId.toUpperCase();
          if(Object.keys(state.members).some(mid => mid.toUpperCase() === id)){ dup++; return; }
          state.members[id] = { id, name: rawName };
          // ensure attendance key on existing events
          Object.values(state.events).forEach(ev => ev.attendance[id] = false);
          added++;
        });
        saveState();
        renderMembersTable();
        alert(`Import complete. Added ${added} members. Skipped ${skipped} invalid rows. ${dup} duplicates.`);
        importCsvInput.value = null;
      };
      reader.readAsText(f);
    });
  }


  btnLogin.addEventListener('click', () => {
    const user = loginUsername.value.trim();
    const pass = loginPassword.value;
    if(!user || !pass) return alert('Provide username and password');
    state.auth = state.auth || { users: {}, currentUser: null };
    const u = state.auth.users[user];
    if(!u || u.passwordHash !== simpleHash(pass)) return alert('Invalid username or password');
    state.auth.currentUser = user;
    saveState();
    updateAuthUI();
  });

  btnLogout.addEventListener('click', () => {
    if(state.auth) state.auth.currentUser = null;
    saveState();
    updateAuthUI();
  });

  showPastEventsBtn.addEventListener('click', () => {
    if(!requireAuth()) return;
    const past = Object.values(state.events).slice().sort((a,b)=>b.createdAt - a.createdAt);
    if(past.length === 0) return alert('No events yet');
    const list = past.map(ev => `${new Date(ev.createdAt).toLocaleString()} — ${ev.name}`).join('\n');
    alert('Past events:\n' + list);
  });
}

function requireAuth(){
  if(!state.auth || !state.auth.currentUser){
    alert('You must be logged in to perform this action');
    return false;
  }
  return true;
}

function updateAuthUI(){
  state.auth = state.auth || { users: {}, currentUser: null };
  if(state.auth.currentUser){
    authMessage.textContent = 'Signed in as ' + state.auth.currentUser;
    btnLogout.style.display = '';
    btnLogin.style.display = 'none';
    // hide login inputs once authenticated
    if(loginUsername) { loginUsername.style.display = 'none'; loginUsername.disabled = true; }
    if(loginPassword) { loginPassword.style.display = 'none'; loginPassword.disabled = true; }
    appContent.style.display = '';
    authSection.style.display = '';
  } else {
    authMessage.textContent = 'You must sign in to add events or see past events.';
    btnLogout.style.display = 'none';
    btnLogin.style.display = '';
    // show login inputs when signed out
    if(loginUsername) { loginUsername.style.display = ''; loginUsername.disabled = false; }
    if(loginPassword) { loginPassword.style.display = ''; loginPassword.disabled = false; }
    appContent.style.display = 'none';
  }
}

function renderEventOptions(){
  eventList.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- Select event --';
  eventList.appendChild(placeholder);
  Object.values(state.events).forEach(ev => {
    const opt = document.createElement('option');
    opt.value = ev.id;
    opt.textContent = ev.name;
    eventList.appendChild(opt);
  });
  if(state.selectedEventId) eventList.value = state.selectedEventId;
}

function renderMembersTable(){
  membersTableBody.innerHTML = '';
  const eventId = state.selectedEventId;
  if(!eventId){
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'no-members';
    td.textContent = 'No event selected. Create or choose an event.';
    tr.appendChild(td);
    membersTableBody.appendChild(tr);
    return;
  }

  // ensure attendance keys exist
  Object.keys(state.members).forEach(mid => {
    if(typeof state.events[eventId].attendance[mid] === 'undefined') state.events[eventId].attendance[mid] = false;
  });

  Object.values(state.members).forEach(member => {
    const tr = document.createElement('tr');
  const tdId = document.createElement('td'); tdId.textContent = member.id; tdId.setAttribute('data-label','ID'); tr.appendChild(tdId);
  const tdName = document.createElement('td'); tdName.textContent = member.name; tdName.setAttribute('data-label','Name'); tr.appendChild(tdName);
  const tdPresent = document.createElement('td'); tdPresent.setAttribute('data-label','Present');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!state.events[eventId].attendance[member.id];
    chk.addEventListener('change', () => {
      state.events[eventId].attendance[member.id] = chk.checked;
      saveState();
    });
    tdPresent.appendChild(chk);
    tr.appendChild(tdPresent);

  const tdActions = document.createElement('td'); tdActions.setAttribute('data-label','Actions');
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.className = 'action-btn';
    delBtn.addEventListener('click', () => {
      if(!confirm('Remove member ' + member.name + ' ("' + member.id + '")?')) return;
      delete state.members[member.id];
      // remove attendance keys
      Object.values(state.events).forEach(ev => delete ev.attendance[member.id]);
      saveState();
      renderMembersTable();
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    membersTableBody.appendChild(tr);
  });
}

function buildCsv(){
  const eventId = state.selectedEventId;
  const rows = [];
  const header = ['ID','Name','Present'];
  rows.push(header.join(','));
  if(!eventId) return rows.join('\n');
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  Object.values(state.members).forEach(m => {
    const present = state.events[eventId].attendance[m.id] ? 'p' : 'A';
    rows.push([q(m.id), q(m.name), present].join(','));
  });
  return rows.join('\n');
}


$('#Event').click(function(){
    $("#Events").show();
    $("#Event").hide(); 
    $("#eventRow").show();
});
$('#Events').click(function(){
    $("#Event").show(); 
    $("#Events").hide(); 
    $("#eventRow").hide();
}   );

$('#addMember-1').click(function(){
    $("#addMember-2").show();
    $("#addMember-1").hide(); 
    $("#memberRow").show();
});
$('#addMember-2').click(function(){
    $("#addMember-1").show(); 
    $("#addMember-2").hide(); 
    $("#memberRow").hide();
}   );

$('#addMember-1').click(function(){
    $("#addMember-2").show(); 
    $("#addMember-1").hide(); 
    $("#memberRow").show();
    $("#eventRow").hide();
    $("#Event").show(); 
    $("#Events").hide(); 
}   );
$('#Event').click(function(){
    $("#Events").show();
    $("#Event").hide(); 
    $("#eventRow").show();
    $("#addMember-1").show(); 
    $("#addMember-2").hide();
    $("#memberRow").hide();
}   );
