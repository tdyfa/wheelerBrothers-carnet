'use strict';

const APP_VERSION = 4;
const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
const C = Object.freeze({
  users: 'wbCarnetUsers',
  vehicles: 'wbCarnetVehicles',
  invitations: 'wbCarnetInvitations'
});

const state = {
  user: null,
  profile: null,
  route: 'loading',
  inviteToken: new URLSearchParams(location.search).get('invite') || '',
  invitation: null,
  confirmationResult: null,
  authMode: null,
  userVehicles: [],
  currentVehicleId: null,
  currentVehicle: null,
  currentMembership: null,
  operations: [],
  members: [],
  invitations: [],
  unsubscribers: [],
  toastTimer: null
};

const appEl = document.getElementById('app');
const backButton = document.getElementById('backButton');
const accountButton = document.getElementById('accountButton');
const subtitleEl = document.getElementById('appSubtitle');
subtitleEl.textContent = `Version ${APP_VERSION}`;

function escapeHtml(value){
  return String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function nowMs(){ return Date.now(); }
function asMillis(value){
  if(!value) return 0;
  if(typeof value.toMillis === 'function') return value.toMillis();
  if(typeof value === 'number') return value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
function normalizePlate(value){
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function displayPlate(value){
  const raw = String(value || '').trim().toUpperCase();
  return raw || 'Non renseignée';
}
function normalizePhone(value){
  let phone = String(value || '').trim().replace(/[\s.()-]/g,'');
  if(phone.startsWith('0033')) phone = '+33' + phone.slice(4);
  if(phone.startsWith('33') && !phone.startsWith('+')) phone = '+' + phone;
  if(phone.startsWith('0')) phone = '+33' + phone.slice(1);
  if(!/^\+33[67]\d{8}$/.test(phone)) throw new Error('Saisis un numéro mobile français valide (06 ou 07).');
  return phone;
}
function formatPhone(value){
  const p = String(value || '');
  const match = p.match(/^\+33([1-9])(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return match ? `0${match[1]} ${match[2]} ${match[3]} ${match[4]} ${match[5]}` : p;
}
function maskPhone(value){
  const formatted = formatPhone(value);
  if(formatted.length < 8) return formatted;
  return formatted.slice(0,5) + '•• •• ' + formatted.slice(-2);
}
function formatDate(value){
  if(!value) return 'Date non renseignée';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if(Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
}
function formatDateTime(value){
  const ms = asMillis(value);
  if(!ms) return '—';
  return new Date(ms).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function formatMileage(value){
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('fr-FR')} km` : 'Kilométrage non renseigné';
}
function randomToken(){
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function isManagerRole(role){ return role === 'owner' || role === 'atelier_admin'; }
function invitationStatus(invite){
  if(!invite) return 'unknown';
  if(invite.status === 'pending' && asMillis(invite.expiresAt) <= nowMs()) return 'expired';
  return invite.status || 'unknown';
}
function inviteStatusLabel(status){
  return ({pending:'Invitation en attente',used:'Accès actif',cancelled:'Invitation annulée',revoked:'Accès révoqué',expired:'Invitation expirée'})[status] || 'État inconnu';
}
function serverTimestamp(){ return firebase.firestore.FieldValue.serverTimestamp(); }
function timestampFromMillis(ms){ return firebase.firestore.Timestamp.fromMillis(ms); }
function userRef(uid){ return db.collection(C.users).doc(uid); }
function vehicleRef(id){ return db.collection(C.vehicles).doc(id); }
function memberRef(vehicleId, uid){ return vehicleRef(vehicleId).collection('members').doc(uid); }
function userVehicleRef(uid, vehicleId){ return db.collection(C.users).doc(uid).collection('vehicles').doc(vehicleId); }
function operationRef(vehicleId, operationId){ return vehicleRef(vehicleId).collection('operations').doc(operationId); }
function invitationRef(token){ return db.collection(C.invitations).doc(token); }

function showToast(message){
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(()=>toast.classList.remove('show'),2600);
}
function setHeader({back=false,account=Boolean(state.user),subtitle=`Version ${APP_VERSION}`}={}){
  backButton.classList.toggle('hidden',!back);
  accountButton.classList.toggle('hidden',!account);
  subtitleEl.textContent = subtitle;
}
function setLoading(message='Chargement…'){
  setHeader({account:Boolean(state.user)});
  appEl.innerHTML = `<section class="screen centered-screen"><div class="card loading-card"><div class="spinner"></div><p>${escapeHtml(message)}</p></div></section>`;
}
function clearSubscriptions(){
  state.unsubscribers.forEach(unsub=>{ try{ unsub(); }catch(_e){} });
  state.unsubscribers = [];
}
function openModal(title, bodyHtml){
  closeModal();
  const wrapper = document.createElement('div');
  wrapper.id = 'modalBackdrop';
  wrapper.className = 'modal-backdrop';
  wrapper.innerHTML = `<section class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="modal-close" id="modalClose" type="button" aria-label="Fermer">×</button></div><div class="modal-body">${bodyHtml}</div></section>`;
  document.body.appendChild(wrapper);
  wrapper.addEventListener('click',e=>{ if(e.target === wrapper) closeModal(); });
  wrapper.querySelector('#modalClose').addEventListener('click',closeModal);
  return wrapper;
}
function closeModal(){ document.getElementById('modalBackdrop')?.remove(); }

async function ensureAuthorizedProfile(user){
  if(!user) return null;
  const ref = userRef(user.uid);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : null;
  if(existing?.status === 'active'){
    await ref.set({
      uid:user.uid,
      phone:user.phoneNumber || existing.phone || '',
      updatedAt:serverTimestamp(),
      lastSeenAt:serverTimestamp()
    },{merge:true});
    state.profile = {...existing,uid:user.uid,phone:user.phoneNumber || existing.phone || ''};
    return state.profile;
  }

  /* Migration sûre des comptes déjà créés avant le passage en accès sur invitation :
     un compte n'est autorisé que s'il possède déjà un accès actif à un véhicule. */
  const pointerSnap = await ref.collection('vehicles').where('status','==','active').limit(1).get();
  if(pointerSnap.empty) return null;
  const vehicleId = pointerSnap.docs[0].id;
  const profile = {
    uid:user.uid,
    phone:user.phoneNumber || '',
    status:'active',
    role:'user',
    authorizationVehicleId:vehicleId,
    authorizedAt:serverTimestamp(),
    updatedAt:serverTimestamp(),
    lastSeenAt:serverTimestamp()
  };
  await ref.set(profile,{merge:true});
  state.profile = profile;
  return profile;
}

let recaptchaVerifier = null;
function getRecaptchaVerifier(){
  if(recaptchaVerifier) return recaptchaVerifier;
  recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container',{
    size:'invisible',
    callback:()=>{},
    'expired-callback':()=>resetRecaptcha()
  });
  return recaptchaVerifier;
}
function resetRecaptcha(){
  try{ recaptchaVerifier?.clear(); }catch(_e){}
  recaptchaVerifier = null;
  document.getElementById('recaptcha-container').innerHTML = '';
}
async function sendSmsCode(phone, mode){
  const normalized = normalizePhone(phone);
  state.authMode = mode;
  state.confirmationResult = null;
  try{
    const verifier = getRecaptchaVerifier();
    state.confirmationResult = await auth.signInWithPhoneNumber(normalized,verifier);
    renderCodeEntry(normalized,mode);
  }catch(error){
    resetRecaptcha();
    throw new Error(firebaseAuthMessage(error));
  }
}
function firebaseAuthMessage(error){
  const code = error?.code || '';
  if(code.includes('invalid-phone-number')) return 'Le numéro de téléphone est invalide.';
  if(code.includes('too-many-requests')) return 'Trop de demandes ont été effectuées. Réessaie plus tard.';
  if(code.includes('quota-exceeded')) return 'Le quota de SMS Firebase est atteint.';
  if(code.includes('billing-not-enabled')) return 'La facturation Firebase doit être activée pour envoyer les SMS.';
  if(code.includes('operation-not-allowed')) return "L'authentification par téléphone n'est pas activée dans Firebase.";
  if(code.includes('unauthorized-domain')) return "Le domaine de WB Carnet n'est pas autorisé dans Firebase Authentication.";
  if(code.includes('invalid-verification-code')) return 'Le code saisi est incorrect.';
  if(code.includes('code-expired')) return 'Le code a expiré. Demande un nouveau SMS.';
  return error?.message || 'Une erreur est survenue.';
}
async function confirmSmsCode(code){
  if(!state.confirmationResult) throw new Error('Demande d’abord un nouveau code.');
  try{
    const credential = await state.confirmationResult.confirm(String(code || '').trim());
    state.user = credential.user;
    resetRecaptcha();
    if(state.authMode === 'invite' && state.inviteToken){
      await acceptInvitation(state.inviteToken,credential.user);
      return;
    }
    const profile = await ensureAuthorizedProfile(credential.user);
    if(!profile){
      await auth.signOut();
      renderLogin('Ce numéro ne dispose pas encore d’une invitation activée.');
      return;
    }
    await showVehicleList();
  }catch(error){
    throw new Error(firebaseAuthMessage(error));
  }
}

function renderLogin(accessMessage=''){
  clearSubscriptions();
  state.route = 'login';
  setHeader({account:false});
  appEl.innerHTML = `
    <section class="screen centered-screen">
      <div style="width:min(430px,100%);">
        <div class="brand-lockup"><img src="report-cover-logo.png" alt="WheelerBrothers"><h1>WB Carnet</h1><p>Le carnet d’entretien partagé de vos véhicules.</p></div>
        <div class="card">
          <div class="card-head"><h2>Accès sur invitation</h2><p>WB Carnet est réservé aux personnes déjà invitées. Votre numéro sert ensuite d’identifiant.</p></div>
          <form class="card-body" id="loginForm">${accessMessage?`<div class="notice warn">${escapeHtml(accessMessage)}</div>`:'<div class="notice">Vous devez avoir activé une première invitation avant de pouvoir vous connecter directement.</div>'}
            <div class="field"><label for="loginPhone">Numéro de téléphone</label><input type="tel" id="loginPhone" inputmode="tel" autocomplete="tel" placeholder="06 12 34 56 78" required></div>
            <div class="help">En demandant le code, vous acceptez que ce numéro soit utilisé par Firebase/Google pour la vérification et la prévention des abus.</div><button class="btn block" id="loginSend" type="submit">Recevoir mon code</button>
            <div class="status" id="loginStatus"></div>
          </form>
        </div>
      </div>
    </section>`;
  document.getElementById('loginForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const status = document.getElementById('loginStatus');
    const button = document.getElementById('loginSend');
    status.className='status';status.textContent='Envoi du SMS…';button.disabled=true;
    try{ await sendSmsCode(document.getElementById('loginPhone').value,'login'); }
    catch(error){ status.className='status error';status.textContent=error.message;button.disabled=false; }
  });
}
function renderCodeEntry(phone,mode){
  state.route = 'code';
  setHeader({back:true,account:false,subtitle:'Vérification du numéro'});
  appEl.innerHTML = `
    <section class="screen centered-screen"><div class="card" style="width:min(430px,100%);">
      <div class="card-head"><h2>Code reçu par SMS</h2><p>Le code a été envoyé au <strong>${escapeHtml(formatPhone(phone))}</strong>.</p></div>
      <form class="card-body" id="codeForm">
        <div class="field"><label for="smsCode">Code de vérification</label><input class="code-input" type="text" id="smsCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" required></div>
        <button class="btn block" id="codeConfirm" type="submit">Valider le code</button>
        <button class="btn link block" id="codeAgain" type="button">Recevoir un nouveau code</button>
        <div class="status" id="codeStatus"></div>
      </form>
    </div></section>`;
  document.getElementById('smsCode').focus();
  document.getElementById('codeForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const status=document.getElementById('codeStatus');const button=document.getElementById('codeConfirm');
    status.className='status';status.textContent='Vérification…';button.disabled=true;
    try{ await confirmSmsCode(document.getElementById('smsCode').value); }
    catch(error){ status.className='status error';status.textContent=error.message;button.disabled=false; }
  });
  document.getElementById('codeAgain').addEventListener('click',async()=>{
    const status=document.getElementById('codeStatus');
    status.className='status';status.textContent='Nouvel envoi…';
    try{ resetRecaptcha(); await sendSmsCode(phone,mode); }
    catch(error){ status.className='status error';status.textContent=error.message; }
  });
}

async function loadInvitation(token){
  const snap = await invitationRef(token).get();
  if(!snap.exists) throw new Error("Cette invitation n'existe pas ou n'est plus disponible.");
  state.invitation = {id:snap.id,...snap.data()};
  return state.invitation;
}
async function renderInvitation(){
  clearSubscriptions();
  state.route = 'invite';
  setLoading("Ouverture de l'invitation…");
  try{
    const invite = await loadInvitation(state.inviteToken);
    const status = invitationStatus(invite);
    const signedPhone = auth.currentUser?.phoneNumber || '';
    const phoneMatches = signedPhone && signedPhone === invite.phone;
    setHeader({back:false,account:Boolean(auth.currentUser),subtitle:'Invitation valable 24 h'});
    let actionHtml='';
    if(status === 'pending'){
      if(auth.currentUser && !phoneMatches){
        actionHtml = `<div class="notice warn">Cette invitation est destinée au <strong>${escapeHtml(formatPhone(invite.phone))}</strong>, mais la session ouverte correspond au ${escapeHtml(formatPhone(signedPhone))}. Déconnectez-vous avant de continuer.</div><div class="actions"><button class="btn danger block" id="inviteSignOut" type="button">Déconnecter le compte actuel</button></div>`;
      }else if(phoneMatches){
        actionHtml = `<button class="btn block" id="inviteAccept" type="button">Activer mon accès</button><div class="status" id="inviteStatus"></div>`;
      }else{
        actionHtml = `<button class="btn block" id="inviteSendCode" type="button">Recevoir mon code par SMS</button><div class="status" id="inviteStatus"></div>`;
      }
    }else if(status === 'used'){
      if(auth.currentUser && invite.usedByUid === auth.currentUser.uid){
        actionHtml = `<div class="notice ok">Cette invitation a déjà été activée avec votre compte.</div><div class="actions"><button class="btn block" id="inviteOpenVehicle" type="button">Ouvrir le véhicule</button></div>`;
      }else{
        actionHtml = `<div class="notice warn">Cette invitation a déjà été utilisée. Le lien ne peut pas servir à créer un second accès.</div>`;
      }
    }else if(status === 'expired'){
      actionHtml = `<div class="notice warn">Cette invitation a expiré après 24 heures. Demandez un nouveau lien à la personne qui vous l’a envoyée.</div>`;
    }else{
      actionHtml = `<div class="notice warn">${escapeHtml(inviteStatusLabel(status))}. Ce lien n’est plus utilisable.</div>`;
    }
    appEl.innerHTML = `
      <section class="screen centered-screen"><div class="card" style="width:min(520px,100%);">
        <div class="card-head"><h1>Invitation WB Carnet</h1><p>Accès au carnet d’entretien partagé d’un véhicule.</p></div>
        <div class="card-body">
          <div class="invite-summary">
            <div class="invite-row"><span>Véhicule</span><strong>${escapeHtml(invite.model || 'Véhicule')}</strong></div>
            <div class="invite-row"><span>Immatriculation</span><strong>${escapeHtml(displayPlate(invite.plate))}</strong></div>
            <div class="invite-row"><span>Motorisation</span><strong>${escapeHtml(invite.engine || 'Non renseignée')}</strong></div>
            <div class="invite-row"><span>Propriétaire</span><strong>${escapeHtml(invite.ownerName || 'Non renseigné')}</strong></div>
            <div class="invite-row"><span>Numéro autorisé</span><strong>${escapeHtml(formatPhone(invite.phone))}</strong></div>
          </div>
          <div class="notice">Le numéro est fixé par l’invitation et ne peut pas être modifié. L’accès sera créé seulement après validation du code envoyé à ce numéro. En demandant le code, vous acceptez que ce numéro soit utilisé par Firebase/Google pour la vérification et la prévention des abus.</div>
          <div style="margin-top:16px">${actionHtml}</div>
        </div>
      </div></section>`;
    document.getElementById('inviteSignOut')?.addEventListener('click',async()=>{ await auth.signOut(); await renderInvitation(); });
    document.getElementById('inviteSendCode')?.addEventListener('click',async()=>{
      const statusEl=document.getElementById('inviteStatus');const button=document.getElementById('inviteSendCode');
      statusEl.className='status';statusEl.textContent='Envoi du SMS…';button.disabled=true;
      try{ await sendSmsCode(invite.phone,'invite'); }
      catch(error){ statusEl.className='status error';statusEl.textContent=error.message;button.disabled=false; }
    });
    document.getElementById('inviteAccept')?.addEventListener('click',async()=>{
      const statusEl=document.getElementById('inviteStatus');const button=document.getElementById('inviteAccept');
      statusEl.className='status';statusEl.textContent='Activation de l’accès…';button.disabled=true;
      try{ await acceptInvitation(state.inviteToken,auth.currentUser); }
      catch(error){ statusEl.className='status error';statusEl.textContent=error.message;button.disabled=false; }
    });
    document.getElementById('inviteOpenVehicle')?.addEventListener('click',async()=>{
      try{ await mergeOwnedSamePlateVehicles(invite.vehicleId,invite.plateKey || ''); }catch(error){ console.warn('Reprise de fusion',error); }
      openVehicle(invite.vehicleId);
    });
  }catch(error){
    setHeader({account:Boolean(auth.currentUser)});
    appEl.innerHTML=`<section class="screen centered-screen"><div class="card" style="width:min(460px,100%);"><div class="card-head"><h2>Invitation indisponible</h2></div><div class="card-body"><div class="notice error">${escapeHtml(error.message)}</div></div></div></section>`;
  }
}

async function acceptInvitation(token,user){
  if(!user?.phoneNumber) throw new Error('Aucun numéro Firebase vérifié.');
  const inviteRef = invitationRef(token);
  let targetVehicleId = '';
  let targetPlateKey = '';
  await db.runTransaction(async transaction=>{
    const inviteSnap = await transaction.get(inviteRef);
    if(!inviteSnap.exists) throw new Error("L'invitation n'existe plus.");
    const invite = inviteSnap.data();
    const status = invitationStatus(invite);
    if(status === 'used' && invite.usedByUid === user.uid){
      targetVehicleId = invite.vehicleId;
      targetPlateKey = invite.plateKey || '';
      return;
    }
    if(status !== 'pending') throw new Error(inviteStatusLabel(status));
    if(invite.phone !== user.phoneNumber) throw new Error("Le numéro vérifié ne correspond pas à l'invitation.");
    if(asMillis(invite.expiresAt) <= nowMs()) throw new Error("L'invitation a expiré.");
    const vRef = vehicleRef(invite.vehicleId);
    const vehicleSnap = await transaction.get(vRef);
    if(!vehicleSnap.exists) throw new Error("La fiche véhicule n'existe plus.");
    const vehicle = vehicleSnap.data();
    targetVehicleId = invite.vehicleId;
    targetPlateKey = vehicle.plateKey || invite.plateKey || '';

    /* Une invitation ne doit jamais rétrograder le propriétaire ou l'administrateur
       déjà présent sur la fiche, notamment lorsqu'il teste son propre lien. */
    const existingMemberSnap = await transaction.get(memberRef(targetVehicleId,user.uid));
    const existingPointerSnap = await transaction.get(userVehicleRef(user.uid,targetVehicleId));
    const existingMemberRole = existingMemberSnap.exists ? existingMemberSnap.data().role : '';
    const existingPointerRole = existingPointerSnap.exists ? existingPointerSnap.data().role : '';
    const preservedRole = isManagerRole(existingMemberRole)
      ? existingMemberRole
      : (isManagerRole(existingPointerRole) ? existingPointerRole : 'member');

    transaction.set(memberRef(targetVehicleId,user.uid),{
      uid:user.uid,phone:user.phoneNumber,role:preservedRole,status:'active',
      invitedBy:invite.createdBy || '',invitationToken:token,
      activatedAt:serverTimestamp(),updatedAt:serverTimestamp()
    },{merge:true});
    transaction.set(userVehicleRef(user.uid,targetVehicleId),{
      uid:user.uid,vehicleId:targetVehicleId,role:preservedRole,status:'active',
      plateKey:targetPlateKey,addedAt:serverTimestamp(),updatedAt:serverTimestamp()
    },{merge:true});
    transaction.set(userRef(user.uid),{
      uid:user.uid,
      phone:user.phoneNumber,
      status:'active',
      role:'user',
      authorizationVehicleId:targetVehicleId,
      invitationToken:token,
      authorizedAt:serverTimestamp(),
      createdAt:serverTimestamp(),
      updatedAt:serverTimestamp(),
      lastSeenAt:serverTimestamp()
    },{merge:true});
    transaction.update(inviteRef,{
      status:'used',usedByUid:user.uid,usedAt:serverTimestamp(),updatedAt:serverTimestamp()
    });
  });
  await ensureAuthorizedProfile(user);
  if(targetVehicleId && targetPlateKey){
    try{ await mergeOwnedSamePlateVehicles(targetVehicleId,targetPlateKey); }
    catch(error){ console.warn('Fusion différée',error); showToast('Accès activé. La fusion pourra être relancée plus tard.'); }
  }
  state.inviteToken='';state.invitation=null;
  history.replaceState({},document.title,location.pathname);
  showToast('Accès activé.');
  await openVehicle(targetVehicleId);
}

async function mergeOwnedSamePlateVehicles(targetVehicleId,plateKey){
  const user = auth.currentUser;
  if(!user || !plateKey) return;
  const pointersSnap = await db.collection(C.users).doc(user.uid).collection('vehicles').where('plateKey','==',plateKey).get();
  for(const pointerDoc of pointersSnap.docs){
    const sourceId = pointerDoc.id;
    if(sourceId === targetVehicleId) continue;
    const pointer = pointerDoc.data();
    if(!isManagerRole(pointer.role) || pointer.status !== 'active') continue;
    const sourceSnap = await vehicleRef(sourceId).get();
    if(!sourceSnap.exists) continue;
    const source = sourceSnap.data();
    if(source.origin !== 'personal' || source.plateKey !== plateKey) continue;
    if(source.mergedInto && source.mergedInto !== targetVehicleId) continue;
    await mergeVehicleInto(sourceId,targetVehicleId,source);
  }
}
async function mergeVehicleInto(sourceId,targetId,sourceVehicle){
  const user = auth.currentUser;
  if(!user) throw new Error('Connexion requise.');
  const [membersSnap,targetSnap] = await Promise.all([
    vehicleRef(sourceId).collection('members').get(),
    vehicleRef(targetId).get()
  ]);
  const targetIsAtelier = targetSnap.exists && targetSnap.data().origin === 'atelier';

  /* Première étape atomique : relier les deux fiches. Cette étape est rejouable. */
  const mergeBatch = db.batch();
  mergeBatch.update(vehicleRef(targetId),{
    mergedFrom:firebase.firestore.FieldValue.arrayUnion(sourceId),
    lastMergeSourceId:sourceId,lastMergeBy:user.uid,lastMergeAt:serverTimestamp(),updatedAt:serverTimestamp()
  });
  mergeBatch.update(vehicleRef(sourceId),{
    mergedInto:targetId,status:'merged',mergedAt:serverTimestamp(),updatedAt:serverTimestamp()
  });
  await mergeBatch.commit();

  /* Deuxième étape : recopier chaque accès séparément pour rester sous les limites des règles Firestore. */
  const activeMembers = membersSnap.docs.filter(memberDoc=>memberDoc.data().status === 'active');
  for(const memberDoc of activeMembers){
    const member = memberDoc.data();
    const copiedRole = targetIsAtelier ? 'member' : (member.role === 'owner' ? 'owner' : 'member');
    const memberBatch = db.batch();
    memberBatch.set(memberRef(targetId,memberDoc.id),{
      uid:memberDoc.id,phone:member.phone || '',role:copiedRole,status:'active',
      mergedFromVehicleId:sourceId,updatedAt:serverTimestamp()
    },{merge:true});
    memberBatch.set(userVehicleRef(memberDoc.id,targetId),{
      uid:memberDoc.id,vehicleId:targetId,role:copiedRole,status:'active',
      plateKey:sourceVehicle.plateKey || '',mergedFromVehicleId:sourceId,updatedAt:serverTimestamp()
    },{merge:true});
    await memberBatch.commit();
  }

  /* Tous les accès passent désormais par la fiche cible. */
  if(activeMembers.length){
    const cleanupBatch = db.batch();
    for(const memberDoc of activeMembers){
      cleanupBatch.update(memberRef(sourceId,memberDoc.id),{
        status:'merged',mergedInto:targetId,updatedAt:serverTimestamp()
      });
      cleanupBatch.delete(userVehicleRef(memberDoc.id,sourceId));
    }
    await cleanupBatch.commit();
  }
  showToast('Les fiches portant la même immatriculation ont été fusionnées.');
}

async function showVehicleList(){
  if(!auth.currentUser){ renderLogin(); return; }
  clearSubscriptions();
  state.route='vehicles';state.currentVehicleId=null;state.currentVehicle=null;
  setLoading('Chargement de vos véhicules…');
  const uid = auth.currentUser.uid;
  const unsub = db.collection(C.users).doc(uid).collection('vehicles').where('status','==','active').onSnapshot(async snap=>{
    try{
      const pointers = snap.docs.map(doc=>({id:doc.id,...doc.data()}));
      const vehicles = [];
      for(const pointer of pointers){
        const vSnap = await vehicleRef(pointer.id).get();
        if(!vSnap.exists) continue;
        const vehicle = {id:vSnap.id,...vSnap.data(),_pointer:pointer};
        if(vehicle.mergedInto) continue;
        vehicles.push(vehicle);
      }
      vehicles.sort((a,b)=>(asMillis(b.updatedAt)||0)-(asMillis(a.updatedAt)||0));
      state.userVehicles=vehicles;
      renderVehicleList();
    }catch(error){
      appEl.innerHTML=`<div class="notice error">Impossible de charger les véhicules : ${escapeHtml(error.message)}</div>`;
    }
  },error=>{
    appEl.innerHTML=`<div class="notice error">Impossible de charger les véhicules : ${escapeHtml(error.message)}</div>`;
  });
  state.unsubscribers.push(unsub);
}
function renderVehicleList(){
  setHeader({account:true,subtitle:`${state.userVehicles.length} véhicule${state.userVehicles.length>1?'s':''}`});
  const cards = state.userVehicles.map(v=>`
    <article class="card vehicle-card" data-vehicle-id="${escapeHtml(v.id)}" tabindex="0">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <h2 class="vehicle-name">${escapeHtml(v.model || 'Véhicule')}</h2>
          <span class="badge ${v.origin==='atelier'?'ok':'muted'}">${v.origin==='atelier'?'WheelerBrothers':'Personnel'}</span>
        </div>
        <span class="vehicle-plate">${escapeHtml(displayPlate(v.plate))}</span>
        <div class="vehicle-meta"><span><strong>Propriétaire :</strong> ${escapeHtml(v.ownerName || 'Non renseigné')}</span><span><strong>Motorisation :</strong> ${escapeHtml(v.engine || 'Non renseignée')}</span></div>
      </div>
    </article>`).join('');
  appEl.innerHTML=`
    <section class="screen">
      <div class="page-head"><div><h1>Mes véhicules</h1><p>Vos carnets personnels et les véhicules partagés avec vous.</p></div><button class="btn" id="addVehicle" type="button">+ Ajouter un véhicule</button></div>
      ${state.userVehicles.length ? `<div class="vehicle-grid">${cards}</div>` : `<div class="card empty-state"><h2>Aucun véhicule</h2><p>Créez votre première fiche véhicule. Votre compte a été autorisé par une invitation WheelerBrothers.</p><button class="btn" id="addVehicleEmpty" type="button">Ajouter un véhicule</button></div>`}
    </section>`;
  document.getElementById('addVehicle')?.addEventListener('click',()=>renderVehicleForm());
  document.getElementById('addVehicleEmpty')?.addEventListener('click',()=>renderVehicleForm());
  appEl.querySelectorAll('[data-vehicle-id]').forEach(card=>{
    const open=()=>openVehicle(card.dataset.vehicleId);
    card.addEventListener('click',open);
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
  });
}

async function openVehicle(vehicleId){
  if(!auth.currentUser){ renderLogin(); return; }
  clearSubscriptions();
  state.route='vehicle';state.currentVehicleId=vehicleId;state.operations=[];state.members=[];state.invitations=[];
  setLoading('Chargement du carnet…');
  const vSnap = await vehicleRef(vehicleId).get();
  if(!vSnap.exists){ showToast("Cette fiche n'existe plus."); return showVehicleList(); }
  const initial = {id:vSnap.id,...vSnap.data()};
  if(initial.mergedInto) return openVehicle(initial.mergedInto);
  state.currentVehicle=initial;
  const membershipSnap = await memberRef(vehicleId,auth.currentUser.uid).get();
  if(!membershipSnap.exists || membershipSnap.data().status !== 'active'){
    showToast("Vous n'avez plus accès à cette fiche.");
    return showVehicleList();
  }
  state.currentMembership={id:membershipSnap.id,...membershipSnap.data()};
  subscribeCurrentVehicle();
}
function subscribeCurrentVehicle(){
  clearSubscriptions();
  const vehicleId=state.currentVehicleId;
  const vUnsub=vehicleRef(vehicleId).onSnapshot(async snap=>{
    if(!snap.exists) return showVehicleList();
    const vehicle={id:snap.id,...snap.data()};
    if(vehicle.mergedInto) return openVehicle(vehicle.mergedInto);
    const previousMerged = JSON.stringify(state.currentVehicle?.mergedFrom || []);
    state.currentVehicle=vehicle;
    renderVehicleDetail();
    if(previousMerged !== JSON.stringify(vehicle.mergedFrom || [])) subscribeOperations(vehicle);
  });
  const mUnsub=memberRef(vehicleId,auth.currentUser.uid).onSnapshot(snap=>{
    if(!snap.exists || snap.data().status!=='active'){
      showToast('Votre accès a été révoqué.');
      return showVehicleList();
    }
    state.currentMembership={id:snap.id,...snap.data()};
    renderVehicleDetail();
  });
  state.unsubscribers.push(vUnsub,mUnsub);
  subscribeOperations(state.currentVehicle);
}
function subscribeOperations(vehicle){
  if(state._operationUnsubs){
    state._operationUnsubs.forEach(u=>{try{u();}catch(_e){}});
    state.unsubscribers = state.unsubscribers.filter(u=>!state._operationUnsubs.includes(u));
  }
  state._operationUnsubs=[];
  const sourceIds=[vehicle.id,...new Set(vehicle.mergedFrom || [])];
  const buckets=new Map();
  const refresh=()=>{
    state.operations=[...buckets.values()].flat().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || (asMillis(b.createdAt)-asMillis(a.createdAt)));
    renderVehicleDetail();
  };
  sourceIds.forEach(sourceId=>{
    const unsub=vehicleRef(sourceId).collection('operations').onSnapshot(snap=>{
      buckets.set(sourceId,snap.docs.map(doc=>({id:doc.id,_vehicleId:sourceId,...doc.data()})));
      refresh();
    },error=>console.warn('Lecture opérations',sourceId,error));
    state._operationUnsubs.push(unsub);
  });
  state.unsubscribers.push(...state._operationUnsubs);
}
function renderVehicleDetail(){
  const v=state.currentVehicle;
  if(!v) return;
  const isManager=isManagerRole(state.currentMembership?.role);
  const canEditVehicle = state.currentMembership?.role === 'atelier_admin' || (v.origin === 'personal' && isManager);
  setHeader({back:true,account:true,subtitle:displayPlate(v.plate)});
  const opsHtml=state.operations.map(op=>{
    const personal=op.source==='personal';
    const editable=personal && op.createdBy===auth.currentUser.uid;
    const sourceLabel=personal ? 'Ajouté dans WB Carnet' : 'WheelerBrothers · lecture seule';
    return `<article class="operation">
      <div class="operation-top"><div class="operation-title">${escapeHtml(op.title || 'Intervention')}</div><div class="operation-date">${escapeHtml(formatDate(op.date))}</div></div>
      ${op.details?`<div class="operation-details">${escapeHtml(op.details)}</div>`:''}
      <div class="operation-meta"><span class="badge ${personal?'muted':'ok'}">${escapeHtml(sourceLabel)}</span>${op.mileage?`<span class="badge muted">${escapeHtml(formatMileage(op.mileage))}</span>`:''}${op.performedBy?`<span class="badge muted">Réalisé par ${escapeHtml(op.performedBy)}</span>`:''}</div>
      ${editable?`<div class="operation-actions"><button class="btn ghost small" data-edit-op="${escapeHtml(op.id)}" data-source-vehicle="${escapeHtml(op._vehicleId)}" type="button">Modifier</button><button class="btn danger small" data-delete-op="${escapeHtml(op.id)}" data-source-vehicle="${escapeHtml(op._vehicleId)}" type="button">Supprimer</button></div>`:''}
    </article>`;
  }).join('');
  appEl.innerHTML=`
    <section class="screen">
      <article class="card">
        <div class="vehicle-profile"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><h1>${escapeHtml(v.model || 'Véhicule')}</h1><span class="vehicle-plate">${escapeHtml(displayPlate(v.plate))}</span></div><span class="badge ${v.origin==='atelier'?'ok':'muted'}">${v.origin==='atelier'?'Fiche WheelerBrothers':'Fiche personnelle'}</span></div><div class="profile-facts" style="margin-top:15px"><span><strong>Propriétaire :</strong> ${escapeHtml(v.ownerName || 'Non renseigné')}</span><span><strong>Motorisation :</strong> ${escapeHtml(v.engine || 'Non renseignée')}</span></div></div>
        <div class="profile-actions"><button class="btn" id="addOperation" type="button">+ Ajouter une opération</button>${canEditVehicle?'<button class="btn ghost" id="editVehicle" type="button">Modifier la fiche</button>':''}${v.origin==='personal' && v.createdBy===auth.currentUser.uid?'<button class="btn danger" id="deleteVehicle" type="button">Supprimer le véhicule</button>':''}</div>
      </article>
      <div class="section-title">Historique des opérations</div>
      ${state.operations.length?`<div class="operation-list">${opsHtml}</div>`:`<div class="card empty-state"><h2>Aucune opération</h2><p>Ajoutez la première intervention réalisée sur ce véhicule.</p><button class="btn" id="addOperationEmpty" type="button">Ajouter une opération</button></div>`}
    </section>`;
  document.getElementById('addOperation')?.addEventListener('click',()=>renderOperationForm());
  document.getElementById('addOperationEmpty')?.addEventListener('click',()=>renderOperationForm());
  document.getElementById('editVehicle')?.addEventListener('click',()=>renderVehicleForm(v));
  document.getElementById('manageAccess')?.addEventListener('click',()=>showAccessManager());
  document.getElementById('deleteVehicle')?.addEventListener('click',deleteCurrentVehicle);
  appEl.querySelectorAll('[data-edit-op]').forEach(button=>button.addEventListener('click',()=>{
    const op=state.operations.find(item=>item.id===button.dataset.editOp && item._vehicleId===button.dataset.sourceVehicle);
    if(op) renderOperationForm(op);
  }));
  appEl.querySelectorAll('[data-delete-op]').forEach(button=>button.addEventListener('click',()=>deleteOperation(button.dataset.sourceVehicle,button.dataset.deleteOp)));
}


async function commitWriteChunks(writes, chunkSize=350){
  for(let start=0; start<writes.length; start+=chunkSize){
    const batch=db.batch();
    for(const applyWrite of writes.slice(start,start+chunkSize)) applyWrite(batch);
    await batch.commit();
  }
}

async function deleteCurrentVehicle(){
  const user=auth.currentUser;
  const vehicle=state.currentVehicle;
  if(!user || !vehicle) return;
  if(vehicle.origin!=='personal' || vehicle.createdBy!==user.uid){
    showToast('Seul le créateur peut supprimer cette fiche personnelle.');
    return;
  }
  const expectedPlate=normalizePlate(vehicle.plate);
  const answer=prompt(`Cette action retirera le véhicule et son historique à toutes les personnes autorisées.\n\nPour confirmer, saisissez l’immatriculation ${displayPlate(vehicle.plate)} :`);
  if(answer===null) return;
  if(normalizePlate(answer)!==expectedPlate){
    showToast('Immatriculation incorrecte. Suppression annulée.');
    return;
  }

  clearSubscriptions();
  setLoading('Suppression du véhicule…');
  try{
    const [membersSnap,invitationsSnap]=await Promise.all([
      vehicleRef(vehicle.id).collection('members').get(),
      db.collection(C.invitations).where('vehicleId','==',vehicle.id).get()
    ]);

    const preliminaryWrites=[];
    for(const inviteDoc of invitationsSnap.docs){
      preliminaryWrites.push(batch=>batch.update(inviteDoc.ref,{
        status:'revoked',revokedAt:serverTimestamp(),revokedBy:user.uid,updatedAt:serverTimestamp()
      }));
    }
    for(const memberDoc of membersSnap.docs){
      if(memberDoc.id===user.uid) continue;
      preliminaryWrites.push(batch=>batch.update(memberDoc.ref,{
        status:'revoked',revokedAt:serverTimestamp(),revokedBy:user.uid,updatedAt:serverTimestamp()
      }));
      preliminaryWrites.push(batch=>batch.delete(userVehicleRef(memberDoc.id,vehicle.id)));
    }
    await commitWriteChunks(preliminaryWrites);

    const finalBatch=db.batch();
    finalBatch.update(vehicleRef(vehicle.id),{
      status:'deleted',deletedAt:serverTimestamp(),deletedBy:user.uid,updatedAt:serverTimestamp()
    });
    finalBatch.update(memberRef(vehicle.id,user.uid),{
      status:'deleted',deletedAt:serverTimestamp(),updatedAt:serverTimestamp()
    });
    finalBatch.delete(userVehicleRef(user.uid,vehicle.id));
    await finalBatch.commit();

    state.currentVehicleId=null;
    state.currentVehicle=null;
    state.currentMembership=null;
    showToast('Véhicule supprimé.');
    await showVehicleList();
  }catch(error){
    console.error('Suppression véhicule',error);
    showToast(`Suppression impossible : ${error.message}`);
    await openVehicle(vehicle.id);
  }
}

function renderVehicleForm(vehicle=null){
  const editing=Boolean(vehicle);
  state.route=editing?'vehicle-edit':'vehicle-new';
  setHeader({back:true,account:true,subtitle:editing?'Modifier la fiche':'Nouveau véhicule'});
  appEl.innerHTML=`<section class="screen"><div class="card"><div class="card-head"><h1>${editing?'Modifier le véhicule':'Ajouter un véhicule'}</h1><p>${editing?'Les changements seront visibles par toutes les personnes autorisées.':'Cette fiche peut rester personnelle ou être partagée ensuite avec vos proches.'}</p></div><form class="card-body" id="vehicleForm">
    <div class="form-grid"><div class="field"><label for="vehicleModel">Modèle</label><input type="text" id="vehicleModel" placeholder="Audi A3" value="${escapeHtml(vehicle?.model||'')}" required></div><div class="field"><label for="vehicleEngine">Motorisation</label><input type="text" id="vehicleEngine" placeholder="2.0 TDI 140" value="${escapeHtml(vehicle?.engine||'')}"></div><div class="field"><label for="vehiclePlate">Immatriculation</label><input type="text" id="vehiclePlate" autocapitalize="characters" placeholder="AB-123-CD" value="${escapeHtml(vehicle?.plate||'')}" required></div><div class="field"><label for="vehicleOwner">Propriétaire</label><input type="text" id="vehicleOwner" placeholder="Jean Dupont" value="${escapeHtml(vehicle?.ownerName||'')}"></div></div>
    <div class="actions"><button class="btn" id="vehicleSave" type="submit">${editing?'Enregistrer':'Créer la fiche'}</button><button class="btn ghost" id="vehicleCancel" type="button">Annuler</button></div><div class="status" id="vehicleStatus"></div>
  </form></div></section>`;
  document.getElementById('vehicleCancel').addEventListener('click',()=>editing?openVehicle(vehicle.id):showVehicleList());
  document.getElementById('vehicleForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const status=document.getElementById('vehicleStatus');const button=document.getElementById('vehicleSave');
    const model=document.getElementById('vehicleModel').value.trim();
    const engine=document.getElementById('vehicleEngine').value.trim();
    const plate=document.getElementById('vehiclePlate').value.trim().toUpperCase();
    const ownerName=document.getElementById('vehicleOwner').value.trim();
    const plateKey=normalizePlate(plate);
    if(!model||!plateKey){status.className='status error';status.textContent='Le modèle et l’immatriculation sont obligatoires.';return;}
    status.className='status';status.textContent='Enregistrement…';button.disabled=true;
    try{
      if(editing){
        await vehicleRef(vehicle.id).update({model,engine,plate,plateKey,ownerName,updatedAt:serverTimestamp()});
        showToast('Fiche mise à jour.');
        await openVehicle(vehicle.id);
      }else{
        const duplicate=state.userVehicles.find(item=>item.plateKey===plateKey);
        if(duplicate) throw new Error('Vous avez déjà une fiche active avec cette immatriculation.');
        const uid=auth.currentUser.uid;const ref=db.collection(C.vehicles).doc();const batch=db.batch();
        batch.set(ref,{model,engine,plate,plateKey,ownerName,origin:'personal',status:'active',createdBy:uid,mergedInto:null,mergedFrom:[],createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        batch.set(memberRef(ref.id,uid),{uid,phone:auth.currentUser.phoneNumber||'',role:'owner',status:'active',activatedAt:serverTimestamp(),updatedAt:serverTimestamp()});
        batch.set(userVehicleRef(uid,ref.id),{uid,vehicleId:ref.id,role:'owner',status:'active',plateKey,addedAt:serverTimestamp(),updatedAt:serverTimestamp()});
        await batch.commit();
        showToast('Véhicule ajouté.');
        await openVehicle(ref.id);
      }
    }catch(error){status.className='status error';status.textContent=error.message;button.disabled=false;}
  });
}

function renderOperationForm(operation=null){
  const editing=Boolean(operation);
  state.route='operation';
  setHeader({back:true,account:true,subtitle:editing?'Modifier une opération':'Nouvelle opération'});
  const today=new Date().toISOString().slice(0,10);
  appEl.innerHTML=`<section class="screen"><div class="card"><div class="card-head"><h1>${editing?'Modifier l’opération':'Ajouter une opération'}</h1><p>Cette opération sera visible par toutes les personnes ayant accès au véhicule.</p></div><form class="card-body" id="operationForm">
    <div class="form-grid-3"><div class="field"><label for="opDate">Date</label><input type="date" id="opDate" value="${escapeHtml(operation?.date||today)}" required></div><div class="field"><label for="opMileage">Kilométrage</label><input type="number" id="opMileage" inputmode="numeric" min="0" placeholder="185000" value="${escapeHtml(operation?.mileage||'')}"></div><div class="field"><label for="opPerformedBy">Réalisé par</label><input type="text" id="opPerformedBy" placeholder="Moi-même, garage…" value="${escapeHtml(operation?.performedBy||'')}"></div></div>
    <div class="field"><label for="opTitle">Opération</label><input type="text" id="opTitle" placeholder="Vidange moteur, pneus, distribution…" value="${escapeHtml(operation?.title||'')}" required></div>
    <div class="field"><label for="opDetails">Détails</label><textarea id="opDetails" placeholder="Pièces utilisées, observations, travaux effectués…">${escapeHtml(operation?.details||'')}</textarea></div>
    <div class="actions"><button class="btn" id="opSave" type="submit">${editing?'Enregistrer':'Ajouter l’opération'}</button><button class="btn ghost" id="opCancel" type="button">Annuler</button></div><div class="status" id="opStatus"></div>
  </form></div></section>`;
  document.getElementById('opCancel').addEventListener('click',()=>openVehicle(state.currentVehicleId));
  document.getElementById('operationForm').addEventListener('submit',async event=>{
    event.preventDefault();const status=document.getElementById('opStatus');const button=document.getElementById('opSave');
    const data={date:document.getElementById('opDate').value,title:document.getElementById('opTitle').value.trim(),details:document.getElementById('opDetails').value.trim(),performedBy:document.getElementById('opPerformedBy').value.trim(),mileage:Number(document.getElementById('opMileage').value)||null};
    if(!data.title){status.className='status error';status.textContent='Indique l’opération réalisée.';return;}
    status.className='status';status.textContent='Enregistrement…';button.disabled=true;
    try{
      if(editing){
        if(operation.source!=='personal'||operation.createdBy!==auth.currentUser.uid) throw new Error('Cette opération est en lecture seule.');
        await operationRef(operation._vehicleId,operation.id).update({...data,updatedAt:serverTimestamp()});
      }else{
        const ref=vehicleRef(state.currentVehicleId).collection('operations').doc();
        await ref.set({...data,source:'personal',createdBy:auth.currentUser.uid,createdByPhone:auth.currentUser.phoneNumber||'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        await vehicleRef(state.currentVehicleId).update({updatedAt:serverTimestamp()});
      }
      showToast(editing?'Opération mise à jour.':'Opération ajoutée.');
      await openVehicle(state.currentVehicleId);
    }catch(error){status.className='status error';status.textContent=error.message;button.disabled=false;}
  });
}
async function deleteOperation(sourceVehicleId,operationId){
  if(!confirm('Supprimer cette opération ?')) return;
  try{ await operationRef(sourceVehicleId,operationId).delete();showToast('Opération supprimée.'); }
  catch(error){ showToast(error.message); }
}

async function showAccessManager(){
  if(!isManagerRole(state.currentMembership?.role)){ showToast('Accès administrateur requis.');return; }
  state.route='access';clearSubscriptions();setLoading('Chargement des accès…');
  const vehicleId=state.currentVehicleId;
  const memberUnsub=vehicleRef(vehicleId).collection('members').onSnapshot(snap=>{
    state.members=snap.docs.map(doc=>({id:doc.id,...doc.data()}));renderAccessManager();
  });
  const inviteUnsub=db.collection(C.invitations).where('vehicleId','==',vehicleId).onSnapshot(snap=>{
    state.invitations=snap.docs.map(doc=>({id:doc.id,...doc.data()})).sort((a,b)=>asMillis(b.createdAt)-asMillis(a.createdAt));renderAccessManager();
  });
  state.unsubscribers.push(memberUnsub,inviteUnsub);
}
function renderAccessManager(){
  const v=state.currentVehicle;if(!v)return;
  setHeader({back:true,account:true,subtitle:'Gestion des accès'});
  const activeMembers=state.members.filter(m=>m.status==='active');
  const membersHtml=activeMembers.map(member=>{
    const own=member.id===auth.currentUser.uid;const manager=isManagerRole(member.role);
    return `<div class="access-item"><div class="access-top"><div><div class="access-phone">${escapeHtml(formatPhone(member.phone||''))}</div><div class="access-meta">${manager?(member.role==='atelier_admin'?'Administrateur WheelerBrothers':'Propriétaire de la fiche'):'Accès actif'}${member.activatedAt?` · depuis le ${escapeHtml(formatDateTime(member.activatedAt))}`:''}</div></div><span class="badge ok">Actif</span></div>${!own&&!manager?`<div class="access-actions"><button class="btn danger small" data-revoke-uid="${escapeHtml(member.id)}" type="button">Révoquer l’accès</button></div>`:''}</div>`;
  }).join('');
  const pending=state.invitations.filter(inv=>['pending','cancelled','revoked'].includes(invitationStatus(inv))||invitationStatus(inv)==='expired');
  const invitesHtml=pending.map(inv=>{
    const status=invitationStatus(inv);const canCancel=status==='pending';
    return `<div class="access-item"><div class="access-top"><div><div class="access-phone">${escapeHtml(formatPhone(inv.phone))}</div><div class="access-meta">${escapeHtml(inviteStatusLabel(status))}${inv.expiresAt&&status==='pending'?` · expire le ${escapeHtml(formatDateTime(inv.expiresAt))}`:''}</div></div><span class="badge ${status==='pending'?'warn':'muted'}">${escapeHtml(status)}</span></div>${canCancel?`<div class="access-actions"><button class="btn ghost small" data-copy-invite="${escapeHtml(inv.id)}" type="button">Copier le lien</button><button class="btn danger small" data-cancel-invite="${escapeHtml(inv.id)}" type="button">Annuler</button></div>`:''}</div>`;
  }).join('');
  appEl.innerHTML=`<section class="screen"><div class="page-head"><div><h1>Accès au véhicule</h1><p>${escapeHtml(v.model)} · ${escapeHtml(displayPlate(v.plate))}</p></div><button class="btn" id="newInvite" type="button">+ Inviter un proche</button></div>
    <div class="section-title">Personnes autorisées</div><div class="access-list">${membersHtml||'<div class="notice">Aucun accès actif.</div>'}</div>
    <div class="section-title">Invitations</div><div class="access-list">${invitesHtml||'<div class="notice">Aucune invitation en attente ou récente.</div>'}</div></section>`;
  document.getElementById('newInvite').addEventListener('click',openInviteModal);
  appEl.querySelectorAll('[data-revoke-uid]').forEach(btn=>btn.addEventListener('click',()=>revokeMember(btn.dataset.revokeUid)));
  appEl.querySelectorAll('[data-cancel-invite]').forEach(btn=>btn.addEventListener('click',()=>cancelInvitation(btn.dataset.cancelInvite)));
  appEl.querySelectorAll('[data-copy-invite]').forEach(btn=>btn.addEventListener('click',()=>copyInviteLink(btn.dataset.copyInvite)));
}
function openInviteModal(){
  const modal=openModal('Inviter un proche',`<form id="inviteForm"><div class="field"><label for="invitePhone">Numéro de téléphone</label><input type="tel" id="invitePhone" inputmode="tel" placeholder="06 12 34 56 78" required><div class="help">Le lien sera valable 24 heures et le numéro sera verrouillé sur la page d’activation.</div></div><button class="btn block" id="inviteCreate" type="submit">Créer le lien et ouvrir Messages</button><div class="status" id="inviteCreateStatus"></div></form>`);
  modal.querySelector('#inviteForm').addEventListener('submit',async event=>{
    event.preventDefault();const status=modal.querySelector('#inviteCreateStatus');const button=modal.querySelector('#inviteCreate');
    status.className='status';status.textContent='Création de l’invitation…';button.disabled=true;
    try{
      const invite=await createInvitation(normalizePhone(modal.querySelector('#invitePhone').value));
      status.className='status ok';status.innerHTML=`Invitation créée.<br><button class="btn ghost small" id="copyCreatedInvite" type="button">Copier le lien</button>`;
      modal.querySelector('#copyCreatedInvite').addEventListener('click',()=>copyInviteLink(invite.id));
      openSmsInvitation(invite);
    }catch(error){status.className='status error';status.textContent=error.message;button.disabled=false;}
  });
}
async function createInvitation(phone){
  const v=state.currentVehicle;const token=randomToken();const ref=invitationRef(token);const createdBy=auth.currentUser.uid;
  const data={vehicleId:v.id,phone,role:'member',status:'pending',model:v.model||'',engine:v.engine||'',plate:v.plate||'',plateKey:v.plateKey||'',ownerName:v.ownerName||'',createdBy,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),expiresAt:timestampFromMillis(nowMs()+INVITATION_TTL_MS),usedByUid:null,usedAt:null};
  await ref.set(data);
  return {id:token,...data};
}
function inviteLink(token){ return `${WB_CARNET_PUBLIC_URL.replace(/\/?$/,'/')}?invite=${encodeURIComponent(token)}`; }
function invitationMessage(invite){
  return `Bonjour, voici l’accès au carnet d’entretien WB Carnet pour ${invite.model || 'votre véhicule'} ${invite.plate ? `(${invite.plate})` : ''}. Le lien est valable 24 heures : ${inviteLink(invite.id)}`;
}
function openSmsInvitation(invite){
  const separator=/iPhone|iPad|iPod/i.test(navigator.userAgent)?'&':'?';
  location.href=`sms:${encodeURIComponent(invite.phone)}${separator}body=${encodeURIComponent(invitationMessage(invite))}`;
}
async function copyInviteLink(token){
  try{await navigator.clipboard.writeText(inviteLink(token));showToast('Lien copié.');}
  catch(_error){prompt('Copiez ce lien :',inviteLink(token));}
}
async function cancelInvitation(token){
  if(!confirm('Annuler cette invitation ?'))return;
  try{await invitationRef(token).update({status:'cancelled',cancelledAt:serverTimestamp(),updatedAt:serverTimestamp()});showToast('Invitation annulée.');}
  catch(error){showToast(error.message);}
}
async function revokeMember(uid){
  const member=state.members.find(item=>item.id===uid);if(!member)return;
  if(!confirm(`Révoquer l’accès de ${formatPhone(member.phone)} ?`))return;
  try{
    const batch=db.batch();
    batch.update(memberRef(state.currentVehicleId,uid),{status:'revoked',revokedAt:serverTimestamp(),revokedBy:auth.currentUser.uid,updatedAt:serverTimestamp()});
    batch.delete(userVehicleRef(uid,state.currentVehicleId));
    await batch.commit();showToast('Accès révoqué.');
  }catch(error){showToast(error.message);}
}

function renderAccount(){
  state.route='account';setHeader({back:true,account:false,subtitle:'Compte'});
  appEl.innerHTML=`<section class="screen"><div class="card"><div class="card-head"><h1>Mon compte</h1></div><div class="card-body"><div class="account-line"><span>Identifiant</span><strong>${escapeHtml(formatPhone(auth.currentUser?.phoneNumber||''))}</strong></div><div class="account-line"><span>Accès WB Carnet</span><strong>Autorisé</strong></div><div class="account-line"><span>Véhicules accessibles</span><strong>${state.userVehicles.length}</strong></div><div class="actions"><button class="btn danger block" id="signOut" type="button">Se déconnecter</button></div></div></div></section>`;
  document.getElementById('signOut').addEventListener('click',async()=>{await auth.signOut();state.inviteToken='';history.replaceState({},document.title,location.pathname);renderLogin();});
}

backButton.addEventListener('click',()=>{
  if(state.route==='code') return state.inviteToken?renderInvitation():renderLogin();
  if(state.route==='vehicle') return showVehicleList();
  if(['vehicle-edit','operation'].includes(state.route)) return openVehicle(state.currentVehicleId);
  if(state.route==='vehicle-new'||state.route==='account') return showVehicleList();
  showVehicleList();
});
accountButton.addEventListener('click',renderAccount);

async function boot(){
  if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{})); }
  await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  auth.onAuthStateChanged(async user=>{
    state.user=user;
    if(state.inviteToken){
      await renderInvitation();
      return;
    }
    if(!user){
      renderLogin();
      return;
    }
    setLoading('Vérification de votre accès…');
    try{
      const profile = await ensureAuthorizedProfile(user);
      if(profile){
        await showVehicleList();
      }else{
        await auth.signOut();
        renderLogin('Ce numéro ne dispose pas encore d’une invitation activée.');
      }
    }catch(error){
      console.error('Vérification accès',error);
      await auth.signOut().catch(()=>{});
      renderLogin('Impossible de vérifier votre autorisation. Réessaie plus tard.');
    }
  });
}

boot().catch(error=>{
  setHeader({account:false});
  appEl.innerHTML=`<section class="screen centered-screen"><div class="card" style="width:min(460px,100%);"><div class="card-head"><h2>WB Carnet ne peut pas démarrer</h2></div><div class="card-body"><div class="notice error">${escapeHtml(error.message)}</div></div></div></section>`;
});
