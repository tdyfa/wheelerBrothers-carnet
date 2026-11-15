/* Documents de véhicule — accès authentifié, sans lien de téléchargement permanent. */
(function(global){
  'use strict';
  const LIMIT=20*1024*1024;
  const TYPES=Object.freeze({'application/pdf':'pdf','image/jpeg':'jpeg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'});
  const EXT=Object.freeze({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif'});
  let deps=null, watchedId='', unsubscribe=null, entries=[], problem='', uploadWarning='', busy=false, loading=false, progress='';
  function configure(input){deps=input;}
  function changed(){if(deps?.changed)deps.changed();}
  function stop(){if(unsubscribe)unsubscribe();unsubscribe=null;watchedId='';entries=[];problem='';uploadWarning='';loading=false;}
  function sync(vehicleId,enabled){
    if(!deps||!vehicleId||!enabled){if(watchedId)stop();return;}
    if(watchedId===vehicleId)return;
    stop();watchedId=vehicleId;loading=true;
    unsubscribe=deps.db.collection('wbCarnetVehicles').doc(vehicleId).collection('documents').where('state','in',['ready','uploading','deleting']).onSnapshot(snap=>{
      if(watchedId!==vehicleId)return;
      entries=snap.docs.map(doc=>({id:doc.id,...doc.data()})).sort((a,b)=>{
        const stamp=x=>typeof x?.toMillis==='function'?x.toMillis():(typeof x==='number'?x:0);
        return stamp(b.createdAt)-stamp(a.createdAt);
      });loading=false;problem='';changed();
    },()=>{if(watchedId!==vehicleId)return;loading=false;problem='Impossible de charger les documents. Vérifiez la connexion et vos accès.';changed();});
  }
  function safeText(value){return deps.escapeHtml(value);}
  function date(value){
    if(!value)return '';
    const date=typeof value.toDate==='function'?value.toDate():new Date(typeof value==='number'?value:NaN);return Number.isNaN(date.getTime())?'':date.toLocaleDateString('fr-FR');
  }
  function formatSize(value){return Number.isFinite(Number(value))?`${(Number(value)/1048576).toFixed(1)} Mo`:'';}
  function own(doc){return Boolean(deps.auth.currentUser&&doc.createdBy===deps.auth.currentUser.uid);}
  function canDelete(doc){return own(doc)||deps.isAtelier();}
  function render(){
    if(!watchedId)return '';
    const visible=entries.filter(doc=>doc.state==='ready'||(doc.state!=='deleted'&&canDelete(doc)));
    const rows=visible.map(doc=>{
      const valid=['uploading','ready','deleting'].includes(doc.state);
      if(!valid)return '';
      const pending=doc.state==='uploading'?'Envoi non terminé':doc.state==='deleting'?'Suppression à terminer':'';
      const info=[date(doc.createdAt),formatSize(doc.size),pending].filter(Boolean).map(safeText).join(' · ');
      const open=doc.state==='ready'?`<button class="btn ghost small" type="button" data-document-open="${safeText(doc.id)}" ${busy?'disabled':''}>Ouvrir</button>`:'';
      const complete=doc.state==='uploading'&&canDelete(doc)?`<button class="btn ghost small" type="button" data-document-finish="${safeText(doc.id)}" ${busy?'disabled':''}>Vérifier l’ajout</button>`:'';
      const remove=canDelete(doc)?`<button class="btn danger small" type="button" data-document-delete="${safeText(doc.id)}" ${busy?'disabled':''}>${doc.state==='deleting'?'Terminer la suppression':'Supprimer'}</button>`:'';
      return `<article class="operation"><div class="operation-top"><div class="operation-title">${safeText(doc.name||'Document')}</div></div><div class="operation-meta">${info}</div><div class="operation-actions">${open}${complete}${remove}</div></article>`;
    }).join('');
    return `<div class="section-title">Documents du véhicule</div><article class="card"><p>PDF et photos : 20 Mo maximum par fichier. Les membres du véhicule et l’Atelier peuvent les consulter.</p><label class="btn" style="display:inline-block;cursor:pointer;${busy?'opacity:.6;':''}">Ajouter un document<input id="vehicleDocumentFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" style="display:none" ${busy||uploadWarning?'disabled':''}></label>${progress?`<p role="status">${safeText(progress)}</p>`:''}${uploadWarning?`<p role="alert">${safeText(uploadWarning)}</p><button class="btn ghost small" id="documentAcknowledge" type="button">J’ai vérifié la liste</button>`:''}${problem?`<p role="status">${safeText(problem)}</p>`:''}</article>${rows?`<div class="operation-list">${rows}</div>`:loading?`<div class="card empty-state"><p>Chargement des documents…</p></div>`:problem?'':`<div class="card empty-state"><p>Aucun document enregistré.</p></div>`}`;
  }
  function id(){
    if(!global.crypto?.getRandomValues)throw new Error('Ce navigateur ne permet pas de sécuriser l’ajout du document.');
    const a=new Uint8Array(16);global.crypto.getRandomValues(a);return Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');
  }
  function inspectFile(file){
    const name=String(file?.name||'').trim();
    if(!name||name.length>160||/[\u0000-\u001f\u007f]/.test(name))throw new Error('Le nom du fichier est invalide ou dépasse 160 caractères.');
    if(!Number.isSafeInteger(file.size)||file.size<1||file.size>LIMIT)throw new Error('Le fichier doit être non vide et ne pas dépasser 20 Mo.');
    const type=String(file.type||'').toLowerCase(),extension=name.split('.').pop().toLowerCase();
    // Une extension ne sert qu'à compléter un type absent (certains fichiers iPhone).
    const contentType=type||EXT[extension];
    if(!TYPES[contentType])throw new Error('Format non accepté. Choisissez un PDF ou une photo JPEG, PNG, WebP, HEIC ou HEIF.');
    return {name,contentType,size:file.size};
  }
  function active(vehicleId,uid){return watchedId===vehicleId&&deps.auth.currentUser?.uid===uid;}
  function endpoint(action,vehicleId,documentId){
    const url=new URL(`https://europe-west1-${deps.projectId}.cloudfunctions.net/wbVehicleDocuments`);
    url.search=new URLSearchParams({action,vehicleId,documentId}).toString();return url.toString();
  }
  async function add(file){
    if(busy||!deps||!watchedId||!deps.auth.currentUser)return;
    const vehicleId=watchedId,uid=deps.auth.currentUser.uid;
    let info,documentId;
    try{info=inspectFile(file);documentId=id();}catch(error){deps.notify(error.message);return;}
    busy=true;progress='Envoi du document…';changed();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
    try{
      const token=await deps.auth.currentUser.getIdToken();
      if(!active(vehicleId,uid))throw new Error('Fiche fermée.');
      const response=await fetch(endpoint('upload',vehicleId,documentId),{
        method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':info.contentType,'X-WB-Name':encodeURIComponent(info.name)},
        body:file,credentials:'omit',cache:'no-store',signal:controller.signal
      });
      if(!response.ok)throw new Error('Envoi non confirmé.');
      if(active(vehicleId,uid))deps.notify('Document ajouté.');
    }catch(error){
      if(active(vehicleId,uid))uploadWarning='Envoi non confirmé : il peut encore être en cours. Vérifiez la liste avant de recommencer pour éviter un doublon.';
      if(active(vehicleId,uid))deps.notify('Envoi non confirmé. Vérifiez la liste des documents.');
    }finally{clearTimeout(timer);busy=false;progress='';changed();}
  }
  async function boundedBlob(response,max){
    const header=response.headers.get('content-length');
    if(header && Number(header)>max)throw new Error('Document trop volumineux.');
    if(response.body?.getReader){
      const reader=response.body.getReader(),parts=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new Error('Document trop volumineux.');}parts.push(value);}
      return new Blob(parts,{type:response.headers.get('content-type')||'application/octet-stream'});
    }
    if(!header || !Number.isFinite(Number(header)) || Number(header)>max)throw new Error('Ce navigateur ne permet pas de limiter la taille du document.');
    const blob=await response.blob();if(blob.size>max)throw new Error('Document trop volumineux.');return blob;
  }
  async function open(doc){
    if(busy||!watchedId||doc.state!=='ready'||!deps.auth.currentUser)return;
    const vehicleId=watchedId,uid=deps.auth.currentUser.uid;
    const expected=`wbCarnetDocuments/${vehicleId}/${doc.createdBy}/${doc.id}`;
    if(doc.path!==expected || !TYPES[doc.contentType] || !Number.isSafeInteger(doc.size)||doc.size<1||doc.size>LIMIT){deps.notify('Document illisible ou référence invalide.');return;}
    busy=true;progress='Ouverture du document…';changed();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
    try{
      const token=await deps.auth.currentUser.getIdToken();
      if(!active(vehicleId,uid))throw new Error('Accès interrompu.');
      const response=await fetch(endpoint('download',vehicleId,doc.id),{headers:{Authorization:`Bearer ${token}`},credentials:'omit',cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('Lecture du document refusée ou impossible.');
      const blob=await boundedBlob(response,LIMIT);
      if(!active(vehicleId,uid))throw new Error('Accès interrompu.');
      const local=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=local;anchor.download=doc.name;anchor.rel='noopener';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(local),60000);
    }catch(error){deps.notify(error.name==='AbortError'?'Le téléchargement a pris trop de temps.':error.message||'Impossible d’ouvrir le document.');}
    finally{clearTimeout(timer);busy=false;progress='';changed();}
  }
  async function finish(doc){
    if(busy||!watchedId||!canDelete(doc)||!deps.auth.currentUser||doc.state!=='uploading')return;
    const vehicleId=watchedId,uid=deps.auth.currentUser.uid;
    busy=true;progress='Vérification du document…';changed();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
    try{
      const token=await deps.auth.currentUser.getIdToken();if(!active(vehicleId,uid))throw new Error('Fiche fermée.');
      const response=await fetch(endpoint('finalize',vehicleId,doc.id),{method:'POST',headers:{Authorization:`Bearer ${token}`},credentials:'omit',cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('Envoi non confirmé.');
      if(active(vehicleId,uid)){uploadWarning='';deps.notify('Document ajouté.');}
    }catch(error){if(active(vehicleId,uid))deps.notify('Ajout non confirmé. Vous pouvez supprimer cette ligne puis renvoyer le fichier.');}
    finally{clearTimeout(timer);busy=false;progress='';changed();}
  }
  async function remove(doc){
    if(busy||!watchedId||!canDelete(doc)||!deps.auth.currentUser||!['uploading','ready','deleting'].includes(doc.state))return;
    if(!global.confirm('Supprimer ce document pour tous les membres du véhicule ?'))return;
    const vehicleId=watchedId,uid=deps.auth.currentUser.uid;
    const expected=`wbCarnetDocuments/${vehicleId}/${doc.createdBy}/${doc.id}`;
    if(doc.path!==expected){deps.notify('Référence du document invalide.');return;}
    busy=true;progress='Suppression du document…';changed();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
    try{
      const token=await deps.auth.currentUser.getIdToken();
      if(!active(vehicleId,uid))throw new Error('Fiche fermée.');
      const response=await fetch(endpoint('remove',vehicleId,doc.id),{method:'POST',headers:{Authorization:`Bearer ${token}`},credentials:'omit',cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('Suppression non confirmée.');
      if(active(vehicleId,uid))deps.notify('Document supprimé.');
    }catch(error){if(active(vehicleId,uid))deps.notify('Suppression non confirmée. Vérifiez la liste avant de réessayer.');}
    finally{clearTimeout(timer);busy=false;progress='';changed();}
  }
  function bind(root){
    root.querySelector('#documentAcknowledge')?.addEventListener('click',()=>{if(!global.confirm('Avez-vous vérifié la liste ? Un envoi précédent peut encore être en cours.'))return;uploadWarning='';changed();});
    root.querySelector('#vehicleDocumentFile')?.addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';if(file)void add(file);});
    root.querySelectorAll('[data-document-finish]').forEach(button=>button.addEventListener('click',()=>{const d=entries.find(x=>x.id===button.dataset.documentFinish);if(d)void finish(d);}));
    root.querySelectorAll('[data-document-open]').forEach(button=>button.addEventListener('click',()=>{const d=entries.find(x=>x.id===button.dataset.documentOpen);if(d)void open(d);}));
    root.querySelectorAll('[data-document-delete]').forEach(button=>button.addEventListener('click',()=>{const d=entries.find(x=>x.id===button.dataset.documentDelete);if(d)void remove(d);}));
  }
  global.WBCarnetDocuments={configure,sync,stop,render,bind};
})(window);
