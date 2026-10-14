
'use strict';

const API    = window.location.origin;
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;

/* ── DURUM ──────────────────────────────── */
let TOKEN   = localStorage.getItem('token')  || null;
let MY_ID   = parseInt(localStorage.getItem('uid'))   || null;
let MY_USER = localStorage.getItem('uname') || null;
let MY_DISP = localStorage.getItem('udisp') || null;
let MY_AV   = localStorage.getItem('uav')   || null;

let ws = null, wsTimer = null;
let curRoom = null;
let curDmId = null;
let rooms = [], online = [];
let replyTo = null;
let lastMG  = null;
let ctxData = null;

/* ── WebRTC: 1-1 ── */
let pc = null, localStream = null;
let callPid = null, callPname = null, callSdp = null;
let micOff = false, camOff = false;

/* ── WebRTC: GRUP ── */
let groupPeers   = new Map();  // uid -> { pc, stream }
let groupStream  = null;
let groupRoomId  = null;
let isGroupCall  = false;

/* ── Zamanlayıcı ── */
let callTick = null, callSec = 0;

const PAL = ['#3b82f6','#8b5cf6','#22c55e','#ef4444','#f59e0b',
             '#06b6d4','#ec4899','#f97316','#14b8a6','#6366f1'];
const AVC = {};
function col(id){ id=parseInt(id)||0; if(!AVC[id]) AVC[id]=PAL[Math.abs(id*7)%PAL.length]; return AVC[id]; }

const EMOJIS=['😀','😂','🤣','😅','😊','🥰','😍','😎','🤩','🥺',
  '😢','😭','😤','😡','😱','🤔','🫠','🥳','🤯','😈',
  '👍','👎','❤️','🔥','✨','🎉','🙏','💯','🚀','⚡',
  '💪','🤙','👋','🫶','🤝','📚','☕','🍕','🎵','🎮',
  '💀','🫣','😇','🌟','😮','🤭','😏','🙃','😬','🫡'];

function getIceConfig(){
  const s=[
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun1.l.google.com:19302'}
  ];
  const tu=window.TURN_URL, tuser=window.TURN_USER, tpass=window.TURN_PASS;
  if(tu&&tuser&&tpass){
    s.push({urls:tu,username:tuser,credential:tpass});
    s.push({urls:tu.replace('turn:','turns:'),username:tuser,credential:tpass});
  }
  return {iceServers:s};
}

/* ── AYARLAR ────────────────────────────── */
const CFG={sound:true,dark:true,notif:false};
function loadCfg(){
  try{Object.assign(CFG,JSON.parse(localStorage.getItem('nx_cfg')||'{}'));}catch{}
  if(!CFG.dark) document.body.classList.add('light');
  g('s-sound').checked=CFG.sound;
  g('s-dark').checked=CFG.dark;
}
function saveSetting(k,v){CFG[k]=v;localStorage.setItem('nx_cfg',JSON.stringify(CFG));}
function toggleDark(on){document.body.classList.toggle('light',!on);saveSetting('dark',on);}
function askNotif(el){
  if(!('Notification' in window)){el.checked=false;return;}
  Notification.requestPermission().then(p=>{el.checked=p==='granted';saveSetting('notif',el.checked);});
}

/* ── BAŞLANGIÇ ──────────────────────────── */
window.addEventListener('DOMContentLoaded',()=>{
  loadCfg();
  buildEmoji();

  document.addEventListener('click',e=>{
    if(!e.target.closest('#emoji-box')&&!e.target.closest('#btn-emoji'))
      g('emoji-box').classList.add('hidden');
    if(!e.target.closest('#ctx'))
      g('ctx').classList.add('hidden');
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){g('ctx').classList.add('hidden');cancelReply();}
  });

  // TURN config yükle (varsa)
  const ts=document.createElement('script');
  ts.src='/js/turn-config.js'; ts.onerror=()=>{};
  document.head.appendChild(ts);

  if(TOKEN){showApp();connectWS();}
  else showAuth();
});

/* ── AUTH ───────────────────────────────── */
function showAuth(){g('screen-auth').classList.add('active');g('screen-app').classList.remove('active');}
function showApp(){g('screen-auth').classList.remove('active');g('screen-app').classList.add('active');renderMe();}
function authTab(t){
  g('form-in').classList.toggle('hidden',t!=='in');
  g('form-reg').classList.toggle('hidden',t!=='reg');
  g('tab-in').classList.toggle('active',t==='in');
  g('tab-reg').classList.toggle('active',t==='reg');
  g('auth-err').classList.add('hidden');
}
async function login(){
  const u=g('in-user').value.trim(),p=g('in-pass').value;
  if(!u||!p) return authErr('Tüm alanları doldurun');
  const r=await POST('/api/login',{username:u,password:p});
  if(r.error) return authErr(r.error);
  saveAuth(r);showApp();connectWS();
}
async function register(){
  const u=g('reg-user').value.trim(),dn=g('reg-name').value.trim(),
        p=g('reg-pass').value,p2=g('reg-pass2').value;
  if(!u||!p) return authErr('Tüm alanları doldurun');
  if(p!==p2) return authErr('Şifreler eşleşmiyor');
  const r=await POST('/api/register',{username:u,password:p,display_name:dn});
  if(r.error) return authErr(r.error);
  saveAuth(r);showApp();connectWS();
}
function saveAuth(d){
  TOKEN=d.token;MY_ID=parseInt(d.id);MY_USER=d.username;
  MY_DISP=d.display_name||d.username;MY_AV=d.avatar||null;
  ls('token',TOKEN);ls('uid',MY_ID);ls('uname',MY_USER);ls('udisp',MY_DISP);ls('uav',MY_AV||'');
}
function authErr(m){const e=g('auth-err');e.textContent=m;e.classList.remove('hidden');}
function logout(){localStorage.clear();ws?.close();stopAllStreams();location.reload();}

function stopAllStreams(){
  localStream?.getTracks().forEach(t=>t.stop());
  groupStream?.getTracks().forEach(t=>t.stop());
  localStream=null;groupStream=null;
}

/* ── WEBSOCKET ──────────────────────────── */
function connectWS(){
  setConn('connecting');
  ws=new WebSocket(WS_URL);
  ws.onopen=()=>wsSend({type:'auth',token:TOKEN});
  ws.onmessage=e=>{try{onWS(JSON.parse(e.data));}catch(err){console.error(err);}};
  ws.onclose=()=>{setConn('disconnected');clearTimeout(wsTimer);wsTimer=setTimeout(connectWS,3000);};
  ws.onerror=()=>ws.close();
}
function wsSend(d){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(d));}

/* ── MERKEZ WS İŞLEYİCİ ─────────────────── */
function onWS(m){
  switch(m.type){

    case 'auth_ok':
      setConn('connected');
      MY_DISP=m.display_name||MY_USER;MY_AV=m.avatar||null;
      ls('udisp',MY_DISP);ls('uav',MY_AV||'');
      renderMe();loadRooms();
      break;

    case 'online_users': online=m.users; renderUsers(); break;
    case 'user_offline': online=online.filter(u=>u.id!==m.userId); renderUsers(); break;

    case 'room_message':
      if(curRoom?.type==='room'&&curRoom.id===m.roomId) addMsg(m);
      else{bumpRoom(m.roomId);notif(m.display_name||m.username,m.content||'');}
      break;

    case 'direct_message':
      if(curRoom?.type==='dm'&&(m.senderId===curDmId||m.receiverId===curDmId)){
        addMsg({...m,userId:m.senderId,username:m.senderUsername,
                display_name:m.senderDisplay,avatar:m.senderAvatar});
      } else if(m.senderId!==MY_ID){
        notif(m.senderDisplay||m.senderUsername,m.content||'');
        toast(`📩 ${m.senderDisplay||m.senderUsername}: ${(m.content||'').slice(0,50)}`,'info');
      }
      break;

    case 'user_joined': if(curRoom?.id===m.roomId) addSys(`${m.username} katıldı`); break;
    case 'user_left':   if(curRoom?.id===m.roomId) addSys(`${m.username} ayrıldı`); break;
    case 'typing':      if(curRoom?.id===m.roomId) showTyping(m.username); break;

    case 'message_deleted': if(curRoom?.id===m.roomId) markDeleted(m.messageId); break;
    case 'message_edited':  if(curRoom?.id===m.roomId) markEdited(m.messageId,m.content); break;

    /* ── WebRTC 1-1 ── */
    case 'webrtc_offer':
      if(m.isGroup) handleGroupOffer(m);
      else incomingCall(m);
      break;
    case 'webrtc_answer':
      if(m.isGroup){
        const peer=groupPeers.get(m.callerId);
        if(peer) peer.pc.setRemoteDescription(new RTCSessionDescription(m.sdp)).catch(()=>{});
      } else {
        callAnswer(m);
      }
      break;
    case 'webrtc_ice':
      if(isGroupCall&&groupPeers.has(m.fromId)){
        const p=groupPeers.get(m.fromId);
        if(p&&m.candidate) p.pc.addIceCandidate(new RTCIceCandidate(m.candidate)).catch(()=>{});
      } else if(pc&&m.candidate){
        pc.addIceCandidate(new RTCIceCandidate(m.candidate)).catch(()=>{});
      }
      break;
    case 'webrtc_reject': toast(`${m.fromName} aramayı reddetti`,'error'); cleanCall(); break;
    case 'webrtc_hangup': toast('Görüşme sona erdi','info'); cleanCall(); break;

    /* ── Grup Görüşme ── */
    case 'group_participant_joined':
      if(isGroupCall) connectGroupPeer(m.userId,m.display_name||m.username,m.avatar,true);
      break;
    case 'group_participant_left':
      removeGroupTile(m.userId);groupPeers.delete(m.userId);break;

    /* ── Engelleme ── */
    case 'block_ok':   toast('Kullanıcı engellendi','success');loadBlockList();break;
    case 'unblock_ok': toast('Engel kaldırıldı','success');loadBlockList();break;
    case 'block_list': renderBlockList(m.list);break;

    /* ── Moderatör ── */
    case 'you_are_mod':  toast(`👑 Moderatör oldunuz!`,'success');break;
    case 'mod_assigned': break;
  }
}

/* ── KANALLAR ─────────────────────────── */
async function loadRooms(){
  const data=await GET('/api/rooms');
  if(!Array.isArray(data)) return;
  rooms=data.map(r=>({...r,_u:0}));
  renderRooms();
}
function renderRooms(filter=''){
  const wrap=g('room-list');wrap.innerHTML='';
  const cats={};
  for(const r of rooms){
    if(filter&&!r.name.toLowerCase().includes(filter.toLowerCase())) continue;
    (cats[r.category]||(cats[r.category]=[])).push(r);
  }
  for(const [cat,list] of Object.entries(cats)){
    const hdr=mk('div','cat-hdr');
    hdr.innerHTML=`<span class="cat-lbl">▸ ${esc(cat)}</span>
      <button class="cat-add" onclick="openCreateRoom('${esc(cat)}')" title="Kanal ekle">+</button>`;
    wrap.appendChild(hdr);
    for(const r of list){
      const li=mk('div','room-item'+(curRoom?.type==='room'&&curRoom.id===r.id?' active':''));
      li.dataset.id=r.id;
      li.innerHTML=`<span class="room-icon">#</span><span class="room-name">${esc(r.name.replace('#',''))}</span>`
        +(r._u>0?`<span class="room-badge">${r._u}</span>`:'');
      li.onclick=()=>openRoom(r);
      wrap.appendChild(li);
    }
  }
}
function filterRooms(v){renderRooms(v);}

async function openRoom(room){
  if(curRoom?.type==='room'&&curRoom.id===room.id){closeSB();return;}
  if(curRoom?.type==='room') wsSend({type:'leave_room',roomId:curRoom.id});
  curRoom={id:room.id,name:room.name,type:'room'};curDmId=null;replyTo=null;
  g('chat-prefix').textContent='#';
  g('chat-name').textContent=room.name.replace('#','');
  g('chat-desc').textContent=room.description||'';
  g('chat-sep').style.display=room.description?'':'none';
  setActions('room',null);
  clearChat();enableInput(`#${room.name.replace('#','')} kanalına mesaj yaz...`);
  room._u=0;renderRooms();hlRoom(room.id);
  wsSend({type:'join_room',roomId:room.id});closeSB();
  const msgs=await GET(`/api/rooms/${room.id}/messages`);
  if(Array.isArray(msgs)){msgs.forEach(m=>addMsg(m,true));scrollBot();}
}

async function openDm(user){
  if(!user||parseInt(user.id)===MY_ID) return;
  if(curRoom?.type==='room') wsSend({type:'leave_room',roomId:curRoom.id});
  curDmId=parseInt(user.id);
  curRoom={id:curDmId,name:user.display_name||user.username,type:'dm'};
  replyTo=null;
  g('chat-prefix').textContent='@';
  g('chat-name').textContent=user.display_name||user.username;
  g('chat-desc').textContent='Özel mesaj';
  g('chat-sep').style.display='';
  setActions('dm',user);
  clearChat();enableInput(`@${user.display_name||user.username} kişisine mesaj yaz...`);
  closeSB();
  document.querySelectorAll('.user-item').forEach(li=>
    li.classList.toggle('active',parseInt(li.dataset.uid)===curDmId));
  const msgs=await GET(`/api/dm/${curDmId}`);
  if(Array.isArray(msgs)){
    msgs.forEach(m=>addMsg({...m,userId:parseInt(m.sender_id),username:m.sender_username,
      display_name:m.sender_display||m.sender_username,avatar:m.sender_avatar},true));
    scrollBot();
  }
}

function setActions(type,user){
  const el=g('chat-actions');el.innerHTML='';
  if(type==='dm'&&user){
    const pb=mk('button','ta-btn');pb.textContent='👤';pb.title='Profil';pb.onclick=()=>openProfile(user.id);el.appendChild(pb);
    const cb=mk('button','ta-btn call');cb.textContent='📹';cb.title='Görüntülü Ara';cb.onclick=()=>startCall(user.id);el.appendChild(cb);
  }
  if(type==='room'){
    const gb=mk('button','ta-btn');gb.textContent='📹';gb.title='Grup Görüntülü Görüşme';gb.onclick=()=>startGroupCall(curRoom.id);el.appendChild(gb);
  }
}

/* ── MESAJ GÖNDER ─────────────────────── */
function sendMsg(){
  const inp=g('msg-inp');
  const txt=inp.value.trim();
  if(!txt||!curRoom) return;
  if(curRoom.type==='room'){
    wsSend({type:'room_message',roomId:curRoom.id,content:txt,reply_to:replyTo?.id||null});
  } else {
    wsSend({type:'direct_message',receiverId:curDmId,content:txt});
  }
  inp.value='';cancelReply();inp.focus();
}
function onKey(e){
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();return;}
  if(curRoom?.type==='room') wsSend({type:'typing',roomId:curRoom.id});
}
function onTyping(){}

/* ── DOSYA ──────────────────────────────── */
async function uploadAndSend(input){
  const files=Array.from(input.files);input.value='';
  for(const file of files){
    toast(`📎 ${file.name} yükleniyor...`,'info');
    const fd=new FormData();fd.append('file',file);
    try{
      const res=await fetch(`${API}/api/upload`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`},body:fd});
      const d=await res.json();
      if(d.error){toast(d.error,'error');continue;}
      const p={content:d.is_image?'':d.name,file_url:d.url,file_name:d.name,file_size:d.size,is_image:d.is_image};
      if(curRoom?.type==='room') wsSend({type:'room_message',roomId:curRoom.id,...p});
      else wsSend({type:'direct_message',receiverId:curDmId,...p});
    }catch{toast('Yükleme başarısız','error');}
  }
}

/* ── EMOJİ ──────────────────────────────── */
function buildEmoji(){
  const box=g('emoji-box');
  for(const e of EMOJIS){
    const s=mk('span');s.textContent=e;
    s.onclick=()=>{g('msg-inp').value+=e;g('msg-inp').focus();g('emoji-box').classList.add('hidden');};
    box.appendChild(s);
  }
}
function toggleEmoji(btn){
  const box=g('emoji-box');
  if(!box.classList.contains('hidden')){box.classList.add('hidden');return;}
  const r=btn.getBoundingClientRect();
  box.style.left=Math.max(4,r.left)+'px';
  box.style.bottom=(window.innerHeight-r.top+8)+'px';
  box.style.top='auto';
  box.classList.remove('hidden');
}

/* ── MESAJ RENDER ─────────────────────── */
function addMsg(m,hist=false){
  g('welcome')?.remove();
  const area=g('messages');
  const uid=parseInt(m.userId||m.user_id||m.sender_id||0);
  const name=m.display_name||m.username||m.sender_username||'?';
  const av=m.avatar||m.sender_avatar||null;
  const ts=new Date(m.created_at);
  const isMe=uid===MY_ID;

  const day=ts.toDateString();
  if(area.dataset.day!==day){
    area.dataset.day=day;
    const d=mk('div','date-div');d.innerHTML=`<span>${fmtDate(ts)}</span>`;
    area.appendChild(d);lastMG=null;
  }
  const diff=lastMG?(ts-new Date(lastMG.ts))/1000:9999;
  const cont=lastMG&&lastMG.uid===uid&&diff<300;

  const row=mk('div','mg'+(cont?'':' first'));
  row.dataset.mid=m.id||'';

  let rHtml='';
  if(m.reply_to&&m.reply_data){
    rHtml=`<div class="reply-ref"><span class="rr-user">↩ ${esc(m.reply_data.username||'')}</span>
      <span class="rr-text">${esc((m.reply_data.content||'').slice(0,80))}</span></div>`;
  }
  let body='';
  if(m.is_deleted){
    body=`<span class="mg-text deleted">🚫 Mesaj silindi</span>`;
  } else if(m.file_url&&(m.is_image||/\.(jpg|jpeg|png|gif|webp)$/i.test(m.file_url))){
    body=`<img class="img-msg" src="${esc(m.file_url)}" alt="" onclick="window.open('${esc(m.file_url)}','_blank')" loading="lazy">`;
  } else if(m.file_url){
    const sz=m.file_size?` · ${fmtSize(m.file_size)}`:'';
    body=`<a class="file-msg" href="${esc(m.file_url)}" target="_blank" download>
      <span class="file-icon">${fIcon(m.file_name)}</span>
      <div class="file-info"><div class="file-fname">${esc(m.file_name||'Dosya')}</div><div class="file-fsize">${sz}</div></div></a>`;
  } else {
    body=`<span class="mg-text">${fmtText(m.content||'')}</span>`;
    if(m.is_edited) body+=`<span class="mg-edited">(düzenlendi)</span>`;
  }
  const hdr=cont?'':`<div class="mg-hdr">
    <span class="mg-author" style="color:${col(uid)}" onclick="openProfile(${uid})">${esc(name)}</span>
    <span class="mg-time">${fmtTime(ts)}</span></div>`;
  const avEl=cont?`<div class="mg-sp"></div>`:`<div class="mg-av">${mkAvHtml(uid,name,av,'av36')}</div>`;

  row.innerHTML=`${avEl}<div class="mg-body">${hdr}${rHtml}${body}
    <span class="mg-itime">${fmtTime(ts)}</span></div>`;
  row._d={id:m.id,uid,username:name,content:m.content||'',deleted:!!m.is_deleted};
  row.addEventListener('contextmenu',e=>{e.preventDefault();showCtx(e,row._d,isMe);});
  area.appendChild(row);lastMG={uid,ts:m.created_at};
  if(!hist) scrollBot();
}
function addSys(txt){const d=mk('div','sys-msg');d.textContent=txt;g('messages').appendChild(d);lastMG=null;scrollBot();}
function clearChat(){
  g('messages').innerHTML='<div class="welcome" id="welcome"><div class="welcome-icon">၊၊||၊</div><h2>Echo</h2><p>Kanal veya kişi seçin</p></div>';
  g('messages').removeAttribute('data-day');lastMG=null;
}
function scrollBot(){const a=g('messages');a.scrollTop=a.scrollHeight;}
function enableInput(ph){
  g('msg-inp').disabled=false;g('msg-inp').placeholder=ph;
  g('btn-send').disabled=false;g('btn-emoji').disabled=false;g('btn-file').disabled=false;
  g('msg-inp').focus();
}
function markDeleted(id){
  const r=document.querySelector(`[data-mid="${id}"]`);if(!r) return;
  const s=r.querySelector('.mg-text');if(s){s.className='mg-text deleted';s.innerHTML='🚫 Mesaj silindi';}
  if(r._d) r._d.deleted=true;
}
function markEdited(id,content){
  const r=document.querySelector(`[data-mid="${id}"]`);if(!r) return;
  const s=r.querySelector('.mg-text');if(s) s.innerHTML=fmtText(content);
  let ed=r.querySelector('.mg-edited');
  if(!ed){ed=mk('span','mg-edited');s?.after(ed);}
  if(ed) ed.textContent='(düzenlendi)';
  if(r._d) r._d.content=content;
}

/* ── YAZIYOR ────────────────────────────── */
const typingBy={};
function showTyping(name){
  typingBy[name]=Date.now();
  const names=Object.keys(typingBy).filter(k=>k!=='__t');
  g('typing-bar').style.display='flex';
  g('typing-who').textContent=names.length===1?`${names[0]} yazıyor...`:`${names.join(', ')} yazıyor...`;
  clearTimeout(typingBy['__t']);
  typingBy['__t']=setTimeout(()=>{for(const k in typingBy)delete typingBy[k];g('typing-bar').style.display='none';},3500);
}

/* ── YANIT ──────────────────────────────── */
function setReply(id,username,text){
  replyTo={id,username,text};
  g('reply-bar').classList.remove('hidden');
  g('reply-to-name').textContent=username;
  g('reply-to-text').textContent=text.slice(0,80);
  g('msg-inp').focus();
}
function cancelReply(){replyTo=null;g('reply-bar').classList.add('hidden');}

/* ── CONTEXT MENÜ ─────────────────────── */
function showCtx(e,d,isMe){
  ctxData=d;
  const m=g('ctx');m.classList.remove('hidden');
  m.style.left=Math.min(e.clientX,window.innerWidth-160)+'px';
  m.style.top=Math.min(e.clientY,window.innerHeight-130)+'px';
  g('ctx-edit').style.display=isMe&&!d.deleted?'':'none';
  g('ctx-del').style.display=isMe?'':'none';
}
function ctxReply(){if(!ctxData) return;setReply(ctxData.id,ctxData.username,ctxData.content);g('ctx').classList.add('hidden');}
function ctxEdit(){
  if(!ctxData||ctxData.deleted) return;
  const c=prompt('Mesajı düzenle:',ctxData.content);
  if(c&&c.trim()&&c!==ctxData.content) wsSend({type:'edit_message',messageId:ctxData.id,content:c.trim()});
  g('ctx').classList.add('hidden');
}
function ctxDel(){
  if(!ctxData||!confirm('Mesajı sil?')) return;
  wsSend({type:'delete_message',messageId:ctxData.id});g('ctx').classList.add('hidden');
}

/* ── KULLANICILAR ─────────────────────── */
function renderUsers(){
  const on=online.filter(u=>u.id!==MY_ID);
  g('online-count').textContent=on.length;
  g('online-list').innerHTML='';g('offline-list').innerHTML='';
  on.forEach(u=>g('online-list').appendChild(mkUserItem(u,true)));
}
function mkUserItem(u,isOn){
  const d=mk('div','user-item'+(curDmId===u.id?' active':''));
  d.dataset.uid=u.id;
  d.innerHTML=`${mkAvHtml(u.id,u.display_name||u.username,u.avatar,'av28')}
    <span class="user-lbl">${esc(u.display_name||u.username)}</span>
    <div class="status-dot ${isOn?'sd-on':'sd-off'}"></div>`;
  d.onclick=()=>openDm(u);
  return d;
}

/* ── PROFİL ─────────────────────────────── */
async function openProfile(uid){
  uid=parseInt(uid);if(!uid) return;
  const d=await GET(`/api/profile/${uid}`);
  if(!d||d.error){toast('Profil yüklenemedi','error');return;}
  const isMe=uid===MY_ID;

  setAvEl('pr-av',uid,d.display_name||d.username,d.avatar,'av80');
  g('pr-av-btn').classList.toggle('hidden',!isMe);
  g('pr-name').textContent=d.display_name||d.username;
  g('pr-tag').textContent='@'+d.username;
  g('pr-bio').textContent=d.bio||'—';
  g('pr-since').textContent=new Date(d.created_at).toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'});
  g('pr-edit').classList.add('hidden');
  if(isMe){g('pr-edit-name').value=d.display_name||'';g('pr-edit-bio').value=d.bio||'';}

  const acts=g('pr-actions');acts.innerHTML='';
  if(isMe){
    acts.appendChild(mkBtn('✏️ Düzenle','pr-btn',()=>g('pr-edit').classList.toggle('hidden')));
  } else {
    acts.appendChild(mkBtn('💬 Mesaj','pr-btn',()=>{closeModal('modal-profile');openDm(d);}));
    acts.appendChild(mkBtn('📹 Ara','pr-btn',()=>{closeModal('modal-profile');startCall(uid);}));
    acts.appendChild(mkBtn('🚫 Engelle','pr-btn danger',()=>{
      if(!confirm('Bu kullanıcıyı engellemek istiyor musunuz?')) return;
      wsSend({type:'block_user',targetId:uid});closeModal('modal-profile');
    }));
  }
  g('modal-profile').classList.remove('hidden');
}
function openMyProfile(){openProfile(MY_ID);}
async function saveProfile(){
  const name=g('pr-edit-name').value.trim(),bio=g('pr-edit-bio').value.trim();
  const r=await PUT('/api/profile',{display_name:name,bio});
  if(r.error){toast(r.error,'error');return;}
  MY_DISP=name||MY_USER;ls('udisp',MY_DISP);renderMe();
  g('pr-name').textContent=MY_DISP;g('pr-bio').textContent=bio||'—';
  g('pr-edit').classList.add('hidden');toast('Profil güncellendi ✅','success');
}
async function uploadAvatar(input){
  const file=input.files[0];if(!file) return;
  const fd=new FormData();fd.append('avatar',file);
  const res=await fetch(`${API}/api/avatar`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`},body:fd});
  const d=await res.json();
  if(d.error){toast(d.error,'error');return;}
  MY_AV=d.avatar;ls('uav',d.avatar);renderMe();
  setAvEl('pr-av',MY_ID,MY_DISP,d.avatar,'av80');
  toast('Avatar güncellendi ✅','success');input.value='';
}

/* ── KANAL OLUŞTUR ─────────────────────── */
function openCreateRoom(cat){
  g('new-cat').value=cat||'Genel';g('new-name').value='';g('new-desc').value='';
  g('modal-room').classList.remove('hidden');g('new-name').focus();
}
async function createRoom(){
  const name=g('new-name').value.trim(),desc=g('new-desc').value.trim(),cat=g('new-cat').value;
  if(!name) return;
  const r=await POST('/api/rooms',{name,description:desc,category:cat});
  if(r.error){toast(r.error,'error');return;}
  closeModal('modal-room');await loadRooms();openRoom(r);
}

/* ── AYARLAR ─────────────────────────────── */
function openSettings(){loadBlockList();g('modal-settings').classList.remove('hidden');}
function loadBlockList(){wsSend({type:'get_blocks'});}
function renderBlockList(list){
  const el=g('block-list-settings');if(!el) return;
  if(!list||!list.length){el.innerHTML='<div class="block-empty">Engellenen kullanıcı yok</div>';return;}
  el.innerHTML='';
  for(const b of list){
    const item=mk('div','block-item');
    item.innerHTML=`<span class="block-item-name">${esc(b.display_name||b.username)}</span>
      <button class="block-item-btn" onclick="wsSend({type:'unblock_user',targetId:${b.id}})">Engeli Kaldır</button>`;
    el.appendChild(item);
  }
}

/* ════════════════════════════════════════════
   WebRTC — 1-1 GÖRÜŞME
════════════════════════════════════════════ */
async function startCall(targetId){
  targetId=parseInt(targetId);
  const t=online.find(u=>u.id===targetId);
  if(!t){toast('Kullanıcı çevrimiçi değil','error');return;}
  callPid=targetId;callPname=t.display_name||t.username;

  try{localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});}
  catch{toast('Kamera/mikrofon izni gerekli','error');return;}

  // UI hazırla — 1-1 modda remote video tam ekran, local küçük
  g('vid-remote').classList.remove('hidden');
  g('group-grid').classList.add('hidden');
  g('vid-local').style.display='';
  g('vid-local').srcObject=localStream;

  showCallScreen(callPname,targetId);

  pc=new RTCPeerConnection(getIceConfig());
  localStream.getTracks().forEach(t2=>pc.addTrack(t2,localStream));
  pc.ontrack=e=>{
    g('vid-remote').srcObject=e.streams[0];
    g('call-status').textContent='Bağlandı';
  };
  pc.onicecandidate=e=>{if(e.candidate) wsSend({type:'webrtc_ice',targetId:callPid,candidate:e.candidate});};

  const offer=await pc.createOffer();await pc.setLocalDescription(offer);
  wsSend({type:'webrtc_offer',targetId,sdp:offer});
}

function incomingCall(m){
  callPid=m.callerId;callPname=m.callerName;callSdp=m.sdp;
  g('inc-name').textContent=m.callerName;
  g('inc-sub').textContent='görüntülü aramaya davet ediyor';
  setAvEl('inc-av',m.callerId,m.callerName,m.callerAvatar||null,'av64');
  g('incoming').classList.remove('hidden');pingNotif();
}

async function acceptCall(){
  // Grup daveti mi?
  if(window._pendingGroupOffer){
    g('incoming').classList.add('hidden');
    await joinGroupFromOffer(window._pendingGroupOffer);
    window._pendingGroupOffer=null;
    return;
  }
  g('incoming').classList.add('hidden');

  try{localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});}
  catch{toast('Kamera/mikrofon izni gerekli','error');return;}

  g('vid-remote').classList.remove('hidden');
  g('group-grid').classList.add('hidden');
  g('vid-local').style.display='';
  g('vid-local').srcObject=localStream;

  showCallScreen(callPname,callPid);

  pc=new RTCPeerConnection(getIceConfig());
  localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.ontrack=e=>{
    g('vid-remote').srcObject=e.streams[0];
    g('call-status').textContent='Bağlandı';
    startTimer();
  };
  pc.onicecandidate=e=>{if(e.candidate) wsSend({type:'webrtc_ice',targetId:callPid,candidate:e.candidate});};
  await pc.setRemoteDescription(new RTCSessionDescription(callSdp));
  const ans=await pc.createAnswer();await pc.setLocalDescription(ans);
  wsSend({type:'webrtc_answer',targetId:callPid,sdp:ans});
}

async function callAnswer(m){
  if(!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
  g('call-status').textContent='Bağlandı';startTimer();
}

function rejectCall(){
  g('incoming').classList.add('hidden');
  window._pendingGroupOffer=null;
  wsSend({type:'webrtc_reject',targetId:callPid});callPid=null;
}

function endCall(){
  if(isGroupCall){
    cleanGroupCall();
  } else {
    if(callPid) wsSend({type:'webrtc_hangup',targetId:callPid});
    pc?.close();pc=null;
    localStream?.getTracks().forEach(t=>t.stop());localStream=null;
    callPid=null;callSdp=null;
  }
  micOff=false;camOff=false;
  g('cb-mic').classList.remove('off');g('cb-cam').classList.remove('off');
  g('cb-mic').textContent='🎙️';g('cb-cam').textContent='📹';
  g('vid-local').srcObject=null;g('vid-remote').srcObject=null;
  g('call-screen').classList.add('hidden');
  stopTimer();
}

function showCallScreen(name,uid){
  g('call-who').textContent=name;g('call-status').textContent='Bağlanıyor...';
  setAvEl('call-av',uid,name,null,'av40');
  g('call-screen').classList.remove('hidden');
}

/* ── MİKROFON / KAMERA butonları ─────────────────────────────────────
   Hem 1-1 (localStream) hem grup (groupStream) için çalışır
─────────────────────────────────────────────────────────────────────── */
function toggleMic(){
  const stream = isGroupCall ? groupStream : localStream;
  if(!stream) return;
  micOff=!micOff;
  stream.getAudioTracks().forEach(t=>t.enabled=!micOff);
  g('cb-mic').classList.toggle('off',micOff);
  g('cb-mic').textContent=micOff?'🔇':'🎙️';
  toast(micOff?'Mikrofon kapatıldı':'Mikrofon açıldı','info');
}
function toggleCam(){
  const stream = isGroupCall ? groupStream : localStream;
  if(!stream) return;
  camOff=!camOff;
  stream.getVideoTracks().forEach(t=>t.enabled=!camOff);
  g('cb-cam').classList.toggle('off',camOff);
  g('cb-cam').textContent=camOff?'🚫':'📹';
  toast(camOff?'Kamera kapatıldı':'Kamera açıldı','info');
  // Kendi tile'ını güncelle
  if(isGroupCall){
    const myTile=document.getElementById(`gtile-${MY_ID}`);
    const myVid=myTile?.querySelector('video');
    if(myVid) myVid.style.opacity=camOff?'0':'1';
  }
}

/* ── ZAMANLAYICI ─────────────────────────── */
function startTimer(){
  callSec=0;stopTimer();
  callTick=setInterval(()=>{
    callSec++;
    const m=Math.floor(callSec/60),s=callSec%60;
    g('call-timer').textContent=`${m}:${String(s).padStart(2,'0')}`;
  },1000);
}
function stopTimer(){clearInterval(callTick);callTick=null;g('call-timer').textContent='0:00';}

/* ════════════════════════════════════════════
   WebRTC — GRUP GÖRÜŞME (Mesh P2P)
════════════════════════════════════════════ */
async function startGroupCall(roomId){
  if(!curRoom||curRoom.type!=='room') return;
  const others=online.filter(u=>u.id!==MY_ID);

  try{groupStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});}
  catch{toast('Kamera/mikrofon izni gerekli','error');return;}

  groupRoomId=roomId;isGroupCall=true;micOff=false;camOff=false;

  // Grup modu UI
  g('vid-remote').classList.add('hidden');
  g('vid-local').style.display='none';     // kendi tile'ında göstereceğiz
  g('group-grid').classList.remove('hidden');
  g('call-who').textContent=(curRoom.name.replace('#',''))+' — Grup Görüşmesi';
  g('call-status').textContent=others.length?`${others.length} kişiye bağlanılıyor...`:'Görüşme başladı';
  g('call-screen').classList.remove('hidden');

  // Kendi tile'ı
  addGroupTile(MY_ID,MY_DISP||MY_USER,MY_AV,groupStream,true);

  // Odaya katıl bildirimi
  wsSend({type:'group_join',roomId});

  // Odadaki herkese offer gönder
  for(const u of others){
    await connectGroupPeer(u.id,u.display_name||u.username,u.avatar,true);
  }
  startTimer();
}

async function connectGroupPeer(targetId,name,avatar,initiator){
  if(groupPeers.has(targetId)) return;
  const peerPc=new RTCPeerConnection(getIceConfig());
  groupPeers.set(targetId,{pc:peerPc,stream:null});

  groupStream.getTracks().forEach(t=>peerPc.addTrack(t,groupStream));

  peerPc.ontrack=e=>{
    const stream=e.streams[0];
    const entry=groupPeers.get(targetId);
    if(entry) entry.stream=stream;
    updateGroupTile(targetId,stream);
  };

  peerPc.onicecandidate=e=>{
    if(e.candidate) wsSend({type:'group_ice',targetId,candidate:e.candidate});
  };

  peerPc.onconnectionstatechange=()=>{
    if(['disconnected','failed','closed'].includes(peerPc.connectionState)){
      removeGroupTile(targetId);groupPeers.delete(targetId);updateGroupGrid();
    }
  };

  // Önce tile ekle (avatar ile)
  addGroupTile(targetId,name,avatar,null,false);

  if(initiator){
    const offer=await peerPc.createOffer();
    await peerPc.setLocalDescription(offer);
    wsSend({type:'group_offer',targetId,sdp:offer,roomId:groupRoomId});
  }
}

async function handleGroupOffer(msg){
  if(!isGroupCall){
    // Henüz görüşmede değilsek gelen kutu göster
    callPid=msg.callerId;
    g('inc-name').textContent=msg.callerName;
    g('inc-sub').textContent='grup görüşmesine davet ediyor';
    setAvEl('inc-av',msg.callerId,msg.callerName,msg.callerAvatar||null,'av64');
    g('incoming').classList.remove('hidden');
    window._pendingGroupOffer=msg;
    pingNotif();
    return;
  }
  // Zaten gruptaysak doğrudan bağlan
  await answerGroupOffer(msg);
}

async function joinGroupFromOffer(msg){
  if(!groupStream){
    try{groupStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});}
    catch{toast('Kamera/mikrofon izni gerekli','error');return;}
  }
  if(!isGroupCall){
    groupRoomId=msg.roomId||curRoom?.id;isGroupCall=true;micOff=false;camOff=false;
    g('vid-remote').classList.add('hidden');
    g('vid-local').style.display='none';
    g('group-grid').classList.remove('hidden');
    g('call-who').textContent='Grup Görüşmesi';
    g('call-status').textContent='Bağlanılıyor...';
    g('call-screen').classList.remove('hidden');
    addGroupTile(MY_ID,MY_DISP||MY_USER,MY_AV,groupStream,true);
    wsSend({type:'group_join',roomId:groupRoomId});
    startTimer();
  }
  await answerGroupOffer(msg);
}

async function answerGroupOffer(msg){
  const uid=msg.callerId;
  if(groupPeers.has(uid)) return;

  const peerPc=new RTCPeerConnection(getIceConfig());
  groupPeers.set(uid,{pc:peerPc,stream:null});
  groupStream.getTracks().forEach(t=>peerPc.addTrack(t,groupStream));

  peerPc.ontrack=e=>{
    const stream=e.streams[0];
    const entry=groupPeers.get(uid);
    if(entry) entry.stream=stream;
    updateGroupTile(uid,stream);
  };
  peerPc.onicecandidate=e=>{
    if(e.candidate) wsSend({type:'group_ice',targetId:uid,candidate:e.candidate});
  };

  addGroupTile(uid,msg.callerName,msg.callerAvatar||null,null,false);

  await peerPc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
  const ans=await peerPc.createAnswer();
  await peerPc.setLocalDescription(ans);
  wsSend({type:'group_answer',targetId:uid,sdp:ans});
}

function cleanGroupCall(){
  if(groupRoomId) wsSend({type:'group_leave',roomId:groupRoomId});
  for(const [,peer] of groupPeers){try{peer.pc.close();}catch{}}
  groupPeers.clear();
  groupStream?.getTracks().forEach(t=>t.stop());groupStream=null;
  g('group-grid').innerHTML='';
  g('group-grid').classList.add('hidden');
  g('vid-remote').classList.remove('hidden');
  g('vid-local').style.display='';
  groupRoomId=null;isGroupCall=false;
  window._pendingGroupOffer=null;
}

/* ── GRUP TILE YÖNETİMİ ─────────────────── */
function addGroupTile(uid,name,avatar,stream,isMe){
  if(document.getElementById(`gtile-${uid}`)){
    if(stream) updateGroupTile(uid,stream);
    return;
  }
  const grid=g('group-grid');
  const tile=mk('div','group-tile');
  tile.id=`gtile-${uid}`;

  if(stream){
    const vid=document.createElement('video');
    vid.autoplay=true;vid.playsInline=true;vid.muted=!!isMe;
    vid.style.cssText='width:100%;height:100%;object-fit:cover;display:block;background:#111;';
    vid.srcObject=stream;
    vid.play().catch(()=>{});
    tile.appendChild(vid);
  } else {
    const av=mk('div','group-tile-av');
    av.style.background=col(uid);
    av.textContent=(name||'?')[0].toUpperCase();
    tile.appendChild(av);
  }
  const lbl=mk('div','group-tile-name');
  lbl.textContent=isMe?(name+' (Sen)'):name;
  tile.appendChild(lbl);
  grid.appendChild(tile);
  updateGroupGrid();
}

function updateGroupTile(uid,stream){
  const tile=document.getElementById(`gtile-${uid}`);if(!tile) return;
  let vid=tile.querySelector('video');
  if(!vid){
    tile.querySelector('.group-tile-av')?.remove();
    vid=document.createElement('video');
    vid.autoplay=true;vid.playsInline=true;
    vid.style.cssText='width:100%;height:100%;object-fit:cover;display:block;background:#111;';
    tile.insertBefore(vid,tile.firstChild);
  }
  vid.srcObject=stream;
  vid.play().catch(()=>{});
}

function removeGroupTile(uid){document.getElementById(`gtile-${uid}`)?.remove();updateGroupGrid();}

function updateGroupGrid(){
  const grid=g('group-grid');
  const count=grid.children.length;
  grid.className='group-grid p'+Math.min(Math.max(count,1),6);
}

/* ── BİLDİRİM ──────────────────────────── */
function pingNotif(){if(!CFG.sound) return;try{const a=new Audio('sounds/universfield-ringtone-046-494552 (1).mp3');a.volume=0.4;a.play().catch(()=>{});}catch{}}
function notif(title,body){
  pingNotif();
  if(CFG.notif&&Notification.permission==='granted')try{new Notification('၊၊||၊ '+title,{body});}catch{}
}

/* ── UI YARDIMCILARI ───────────────────── */
function renderMe(){g('me-name').textContent=MY_DISP||MY_USER;setAvEl('me-av',MY_ID,MY_DISP||MY_USER,MY_AV,'av36');}
function hlRoom(id){document.querySelectorAll('.room-item').forEach(li=>li.classList.toggle('active',parseInt(li.dataset.id)===id));}
function bumpRoom(id){const r=rooms.find(r=>r.id===id);if(r){r._u=(r._u||0)+1;renderRooms();}}
function setConn(s){const d=g('conn-dot');if(!d) return;d.className='conn-dot '+s;}
function openSB(){g('sidebar').classList.add('open');}
function closeSB(){g('sidebar').classList.remove('open');}
function closeModal(id){g(id)?.classList.add('hidden');}

function mkAvHtml(uid,name,av,cls){
  const c=col(uid||0);
  if(av) return `<div class="av ${cls}" style="background:${c}"><img src="${esc(av)}" alt=""></div>`;
  return `<div class="av ${cls}" style="background:${c}">${esc((name||'?')[0].toUpperCase())}</div>`;
}
function setAvEl(elId,uid,name,av,cls){
  const el=document.getElementById(elId);if(!el) return;
  el.className=`av ${cls}`;el.style.background=col(parseInt(uid)||0);
  el.innerHTML=av?`<img src="${esc(av)}" alt="">`:(name||'?')[0].toUpperCase();
}
function mkBtn(lbl,cls,fn){const b=mk('button',cls);b.textContent=lbl;b.onclick=fn;return b;}

/* ── FORMAT ─────────────────────────────── */
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtText(s){
  let t=esc(s);
  t=t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  t=t.replace(/\*(.+?)\*/g,'<em>$1</em>');
  t=t.replace(/`(.+?)`/g,'<code style="background:var(--card);padding:1px 5px;border-radius:4px;font-size:.85em">$1</code>');
  t=t.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener" style="color:var(--acc)">$1</a>');
  return t.replace(/\n/g,'<br>');
}
function fmtTime(d){if(!(d instanceof Date))d=new Date(d);return d.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});}
function fmtDate(d){
  if(!(d instanceof Date))d=new Date(d);
  const now=new Date();
  if(d.toDateString()===now.toDateString()) return 'Bugün';
  if(d.toDateString()===new Date(now-86400000).toDateString()) return 'Dün';
  return d.toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'});
}
function fmtSize(b){if(b<1024) return b+' B';if(b<1048576) return (b/1024).toFixed(1)+' KB';return (b/1048576).toFixed(1)+' MB';}
function fIcon(n){if(!n) return '📎';const e=n.split('.').pop().toLowerCase();return{pdf:'📕',doc:'📝',docx:'📝',txt:'📄',zip:'🗜️',rar:'🗜️',mp4:'🎬',mp3:'🎵',pptx:'📊',xlsx:'📊',csv:'📊'}[e]||'📎';}

/* ── API ────────────────────────────────── */
async function GET(p){try{const r=await fetch(API+p,{headers:{Authorization:`Bearer ${TOKEN}`}});return await r.json();}catch{return {};}}
async function POST(p,b){try{const r=await fetch(API+p,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify(b)});return await r.json();}catch{return {};}}
async function PUT(p,b){try{const r=await fetch(API+p,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify(b)});return await r.json();}catch{return {};}}

/* ── TOAST ──────────────────────────────── */
let _tt=null;
function toast(msg,type='info'){const e=g('toast');e.textContent=msg;e.className=`toast ${type}`;clearTimeout(_tt);_tt=setTimeout(()=>e.classList.add('hidden'),4000);}

/* ── KISALTMALAR ────────────────────────── */
function g(id){return document.getElementById(id);}
function mk(tag,cls){const e=document.createElement(tag);if(cls)e.className=cls;return e;}
function ls(k,v){localStorage.setItem(k,v===null||v===undefined?'':String(v));}
