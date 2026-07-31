'use strict';

/*
 * Moteur PDF partagé avec le Générateur de rapport WheelerBrothers.
 * Le rapport est dessiné page par page dans des canvas, puis assemblé en PDF.
 * Aucun PDF n'est stocké dans Firebase.
 */
(function(global){
  let storage = null;

  function normSection(sec){
    if(!sec || typeof sec !== 'object') return {type:'normal',photos:[],cols:2,rowsPerPage:0};
    if(!sec.type) sec.type='normal';
    if(!Array.isArray(sec.photos)) sec.photos=[];
    if(sec.type==='sym'){
      if(!Array.isArray(sec.photosL)) sec.photosL=[];
      if(!Array.isArray(sec.photosR)) sec.photosR=[];
      if(sec.labelL===undefined) sec.labelL='Gauche';
      if(sec.labelR===undefined) sec.labelR='Droite';
    }
    if(sec.cols===undefined) sec.cols=2;
    if(sec.rowsPerPage===undefined) sec.rowsPerPage=0;
    sec.rowsPerPage=Math.max(0,Math.min(4,Number(sec.rowsPerPage)||0));
    return sec;
  }

  function normalizeReportState(value){
    const s=(value&&typeof value==='object')?value:{};
    if(!Array.isArray(s.sections)) s.sections=[];
    if(!Array.isArray(s.checkpoints)) s.checkpoints=[];
    if(!Array.isArray(s.invoices)) s.invoices=[];
    s.sections.forEach(normSection);
    return s;
  }

function isFirebaseStorageDownloadUrl(value){
  try{
    const host=new URL(value,location.href).hostname;
    return host==='firebasestorage.googleapis.com' || host.endsWith('.storage.googleapis.com') || host==='storage.googleapis.com';
  }catch(e){ return false; }
}

function pdfRemoteBlob(url){
  return fetch(url,{
    method:'GET',
    mode:'cors',
    cache:'no-store',
    credentials:'omit'
  }).then(async response=>{
    if(!response.ok){
      const error=new Error(`Téléchargement image HTTP ${response.status}`);
      error.code=response.status===404?'storage-object-not-found':
        (response.status===401||response.status===403?'storage-read-denied':'storage-download-http');
      throw error;
    }
    const blob=await response.blob();
    if(!blob||!blob.size){
      const error=new Error('Image distante vide');
      error.code='storage-empty-image';
      throw error;
    }
    return blob;
  }).catch(error=>{
    if(error&&error.code) throw error;
    const wrapped=new Error('Le navigateur ne peut pas lire les octets de cette photo Firebase Storage.');
    wrapped.code=isFirebaseStorageDownloadUrl(url)?'firebase-storage-cors':'remote-image-unreadable';
    wrapped.cause=error;
    throw wrapped;
  });
}

async function pdfSourceAsBlob(src){
  if(!src) return null;
  if(typeof src!=='string'){
    const error=new Error('Format de photo inconnu');
    error.code='invalid-image-source';
    throw error;
  }
  if(src.startsWith('data:')){
    const response=await fetch(src);
    if(!response.ok) throw new Error('Image intégrée illisible');
    const blob=await response.blob();
    if(!blob||!blob.size) throw new Error('Image intégrée vide');
    return blob;
  }
  if(src.startsWith('blob:')){
    const response=await fetch(src);
    if(!response.ok) throw new Error('Image locale temporaire illisible');
    return await response.blob();
  }

  let resolvedUrl=src;
  if(storage && isFirebaseStorageDownloadUrl(src)){
    try{
      resolvedUrl=await storage.refFromURL(src).getDownloadURL();
    }catch(error){
      const wrapped=new Error('Accès à la photo du rapport refusé par Firebase Storage.');
      wrapped.code='storage-read-denied';
      wrapped.cause=error;
      throw wrapped;
    }
  }
  return await pdfRemoteBlob(resolvedUrl);
}

function reportPdfFilename(state){
  const clean=value=>String(value||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9_-]+/g,'_')
    .replace(/^_+|_+$/g,'');
  const plate=clean(state.plate)||'sans_immatriculation';
  const date=/^\d{4}-\d{2}-\d{2}$/.test(String(state.date||''))
    ? state.date
    : new Date().toISOString().slice(0,10);
  return `rapport_${plate}_${date}.pdf`;
}

function pdfBase64Bytes(dataUrl){
  const binary=atob(String(dataUrl).split(',')[1]||'');
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return bytes;
}

/* Même principe que l'export historique : chaque page est d'abord dessinée
   dans un canvas, puis les JPEG sont assemblés dans un vrai fichier PDF.
   Aucun aperçu d'impression ni capture html2canvas n'est utilisé. */
function buildReportImagePdf(jpegPages,pageWidthPt=595.28,pageHeightPt=841.89){
  const encoder=new TextEncoder();
  const chunks=[];
  const offsets=[0];
  let length=0;
  const pushBytes=bytes=>{chunks.push(bytes);length+=bytes.length;};
  const pushText=text=>pushBytes(encoder.encode(text));
  const pageCount=jpegPages.length;
  const objectCount=2+pageCount*3;
  pushText('%PDF-1.4\n%âãÏÓ\n');
  const writeObject=(id,parts)=>{
    offsets[id]=length;
    pushText(`${id} 0 obj\n`);parts();pushText('\nendobj\n');
  };
  writeObject(1,()=>pushText('<< /Type /Catalog /Pages 2 0 R >>'));
  const pageIds=jpegPages.map((_,i)=>3+i*3);
  writeObject(2,()=>pushText(`<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`));
  jpegPages.forEach((page,i)=>{
    const pageId=3+i*3,imageId=pageId+1,contentId=pageId+2;
    writeObject(pageId,()=>pushText(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt} ${pageHeightPt}] /Resources << /XObject << /Im${i} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    const imageBytes=pdfBase64Bytes(page.dataUrl);
    writeObject(imageId,()=>{
      pushText(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`);
      pushBytes(imageBytes);pushText('\nendstream');
    });
    const stream=`q\n${pageWidthPt} 0 0 ${pageHeightPt} 0 0 cm\n/Im${i} Do\nQ`;
    writeObject(contentId,()=>pushText(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`));
  });
  const xrefOffset=length;
  pushText(`xref\n0 ${objectCount+1}\n0000000000 65535 f \n`);
  for(let i=1;i<=objectCount;i++) pushText(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
  pushText(`trailer\n<< /Size ${objectCount+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return new Blob(chunks,{type:'application/pdf'});
}

const REPORT_PDF_W=1240;
const REPORT_PDF_H=1754;
const REPORT_PDF_MARGIN=88;

function pdfTextLines(ctx,value,maxWidth){
  const paragraphs=String(value||'').replace(/\r/g,'').split('\n');
  const lines=[];
  paragraphs.forEach((paragraph,index)=>{
    const words=paragraph.trim().split(/\s+/).filter(Boolean);
    if(!words.length){lines.push('');return;}
    let line='';
    words.forEach(word=>{
      const test=line?`${line} ${word}`:word;
      if(line&&ctx.measureText(test).width>maxWidth){lines.push(line);line=word;}
      else line=test;
    });
    if(line) lines.push(line);
    if(index<paragraphs.length-1) lines.push('');
  });
  return lines;
}

function pdfDrawLines(ctx,lines,x,y,lineHeight,maxLines){
  const count=typeof maxLines==='number'?Math.min(lines.length,maxLines):lines.length;
  for(let i=0;i<count;i++) ctx.fillText(lines[i],x,y+i*lineHeight);
  return y+count*lineHeight;
}

function pdfRoundRect(ctx,x,y,w,h,r,fill,stroke){
  const radius=Math.min(r,w/2,h/2);
  ctx.beginPath();ctx.moveTo(x+radius,y);ctx.arcTo(x+w,y,x+w,y+h,radius);
  ctx.arcTo(x+w,y+h,x,y+h,radius);ctx.arcTo(x,y+h,x,y,radius);
  ctx.arcTo(x,y,x+w,y,radius);ctx.closePath();
  if(fill)ctx.fill();if(stroke)ctx.stroke();
}

function pdfDrawContain(ctx,img,x,y,w,h,{border=false,background='#fff'}={}){
  ctx.fillStyle=background;ctx.fillRect(x,y,w,h);
  if(border){ctx.strokeStyle='#d9dde4';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);}
  if(!img||!img.width||!img.height)return;
  const ratio=Math.min(w/img.width,h/img.height);
  const dw=img.width*ratio,dh=img.height*ratio;
  ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
}

async function loadReportPdfImage(src,cache){
  if(!src)return null;
  if(cache.has(src))return cache.get(src);
  const promise=(async()=>{
    let lastError=null;
    for(let attempt=0;attempt<2;attempt++){
      try{
        const blob=await pdfSourceAsBlob(src);
        if(!blob||!blob.size) throw new Error('Image vide');
        if('createImageBitmap' in window){
          try{
            const bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});
            if(bitmap&&bitmap.width&&bitmap.height)return bitmap;
          }catch(e){ lastError=e; }
        }
        const objectUrl=URL.createObjectURL(blob);
        try{
          return await new Promise((resolve,reject)=>{
            const img=new Image();
            img.onload=()=>resolve(img);
            img.onerror=()=>reject(new Error('Décodage de l’image impossible'));
            img.src=objectUrl;
          });
        }finally{
          URL.revokeObjectURL(objectUrl);
        }
      }catch(e){
        lastError=e;
        if(attempt===0) await new Promise(r=>setTimeout(r,250));
      }
    }
    console.error('Photo du rapport inaccessible pour le PDF :',src,lastError);
    if(lastError&&lastError.code) throw lastError;
    const error=new Error('Une photo du rapport n’a pas pu être chargée.');
    error.code='report-image-load-failed';
    error.cause=lastError;
    throw error;
  })();
  cache.set(src,promise);
  return promise;
}

function reportDateFr(value){
  const text=String(value||'');
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)){
    const [y,m,d]=text.split('-');return `${d}/${m}/${y}`;
  }
  return text;
}

async function renderReportPdfPages(state,options={}){
  const s=normalizeReportState(state);
  const pages=[];
  const imageCache=options.imageCache||new Map();
  const logo=await loadReportPdfImage(s.logo||options.defaultLogo||'report-cover-logo.png',imageCache);
  const contentW=REPORT_PDF_W-REPORT_PDF_MARGIN*2;
  const newCanvas=()=>{
    const canvas=document.createElement('canvas');
    canvas.width=REPORT_PDF_W;canvas.height=REPORT_PDF_H;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.textBaseline='top';ctx.fillStyle='#101216';
    return {canvas,ctx,y:REPORT_PDF_MARGIN};
  };
  const drawWatermark=page=>{
    if(!logo)return;
    const maxW=190,maxH=82;
    const ratio=Math.min(maxW/logo.width,maxH/logo.height);
    page.ctx.save();page.ctx.globalAlpha=.09;
    page.ctx.drawImage(logo,REPORT_PDF_W-REPORT_PDF_MARGIN-logo.width*ratio,28,logo.width*ratio,logo.height*ratio);
    page.ctx.restore();
  };
  const finish=page=>pages.push({dataUrl:page.canvas.toDataURL('image/jpeg',.94),width:page.canvas.width,height:page.canvas.height});
  const contentPage=(title)=>{
    const page=newCanvas();drawWatermark(page);
    if(title){
      page.ctx.font='bold 34px Arial';page.ctx.fillStyle='#101216';
      page.ctx.fillText(title,REPORT_PDF_MARGIN,page.y);
      page.y+=58;page.ctx.fillRect(REPORT_PDF_MARGIN,page.y,contentW,4);page.y+=30;
    }
    return page;
  };

  /* Couverture */
  {
    const p=newCanvas(),ctx=p.ctx;
    if(logo){
      const maxW=520,maxH=230,ratio=Math.min(maxW/logo.width,maxH/logo.height);
      ctx.drawImage(logo,(REPORT_PDF_W-logo.width*ratio)/2,p.y,logo.width*ratio,logo.height*ratio);
      p.y+=logo.height*ratio+65;
    }else p.y+=80;
    ctx.textAlign='center';ctx.fillStyle='#101216';ctx.font='bold 48px Arial';
    ctx.fillText(s.title||"RAPPORT D'INTERVENTION",REPORT_PDF_W/2,p.y);p.y+=68;
    ctx.fillRect(REPORT_PDF_W/2-180,p.y,360,5);p.y+=38;
    if(s.summary){
      ctx.font='25px Arial';ctx.fillStyle='#4b5563';
      const lines=pdfTextLines(ctx,s.summary,850);pdfDrawLines(ctx,lines,REPORT_PDF_W/2,p.y,34);
      p.y+=lines.length*34+28;
    }
    ctx.textAlign='left';
    const rows=[
      ["DATE D'INTERVENTION",reportDateFr(s.date)],['MARQUE',s.brand],['MODÈLE',s.model],
      ['MOTORISATION',s.engine],['MISE EN CIRCULATION',s.reg],['IMMATRICULATION',s.plate],['KILOMÉTRAGE',s.km]
    ].filter(row=>String(row[1]||'').trim());
    const tableX=180,tableW=880,labelW=330,rowH=58;
    rows.forEach(([label,value],index)=>{
      const y=p.y+index*rowH;
      ctx.fillStyle='#f4f6f9';ctx.fillRect(tableX,y,labelW,rowH);
      ctx.strokeStyle='#d9dde4';ctx.lineWidth=2;ctx.strokeRect(tableX,y,tableW,rowH);
      ctx.beginPath();ctx.moveTo(tableX+labelW,y);ctx.lineTo(tableX+labelW,y+rowH);ctx.stroke();
      ctx.fillStyle='#4b5563';ctx.font='bold 18px Arial';ctx.fillText(label,tableX+18,y+19);
      ctx.fillStyle='#101216';ctx.font='23px Arial';ctx.fillText(String(value),tableX+labelW+20,y+16);
    });
    p.y+=rows.length*rowH+34;
    if(s.overview){
      const img=await loadReportPdfImage(s.overview,imageCache);
      const available=Math.max(220,REPORT_PDF_H-p.y-150);
      pdfDrawContain(ctx,img,REPORT_PDF_MARGIN,p.y,contentW,available,{border:true,background:'#fafbfc'});
      p.y+=available;
    }
    ctx.textAlign='center';ctx.fillStyle='#6b7280';ctx.font='18px Arial';
    ctx.fillText(`Rapport généré le ${(s.genDate&&s.genDate.trim())?s.genDate.trim():new Date().toLocaleDateString('fr-FR')}`,REPORT_PDF_W/2,REPORT_PDF_H-65);
    ctx.textAlign='left';finish(p);
  }

  /* Sommaire */
  if(s.sections.length){
    let p=contentPage('Sommaire des prestations');
    for(let i=0;i<s.sections.length;i++){
      const sec=s.sections[i];normSection(sec);
      const title=`${sec.title||'(prestation sans titre)'}${sec.type==='sym'?' (G/D)':''}`;
      if(p.y+66>REPORT_PDF_H-REPORT_PDF_MARGIN){finish(p);p=contentPage('Sommaire des prestations (suite)');}
      p.ctx.fillStyle='#101216';p.ctx.beginPath();p.ctx.arc(REPORT_PDF_MARGIN+22,p.y+22,22,0,Math.PI*2);p.ctx.fill();
      p.ctx.fillStyle='#fff';p.ctx.font='bold 20px Arial';p.ctx.textAlign='center';p.ctx.fillText(String(i+1),REPORT_PDF_MARGIN+22,p.y+10);p.ctx.textAlign='left';
      p.ctx.fillStyle='#101216';p.ctx.font='bold 25px Arial';p.ctx.fillText(title,REPORT_PDF_MARGIN+68,p.y+7);
      p.ctx.strokeStyle='#d9dde4';p.ctx.lineWidth=2;p.ctx.beginPath();p.ctx.moveTo(REPORT_PDF_MARGIN,p.y+58);p.ctx.lineTo(REPORT_PDF_W-REPORT_PDF_MARGIN,p.y+58);p.ctx.stroke();
      p.y+=66;
    }
    if(s.products){
      const img=await loadReportPdfImage(s.products,imageCache);
      if(p.y+500>REPORT_PDF_H-REPORT_PDF_MARGIN){finish(p);p=contentPage('Produits / pièces utilisés');}
      pdfDrawContain(p.ctx,img,REPORT_PDF_MARGIN,p.y,contentW,Math.min(600,REPORT_PDF_H-p.y-REPORT_PDF_MARGIN-45),{border:true,background:'#fafbfc'});
    }
    finish(p);
  }

  /* Détail des prestations */
  if(s.sections.length){
    let p=null,firstDetail=true,pageHasSection=false;
    const pageBottom=REPORT_PDF_H-REPORT_PDF_MARGIN;
    const begin=()=>{
      p=contentPage(firstDetail?'Détail des prestations':null);
      firstDetail=false;
      pageHasSection=false;
    };
    const nextPage=()=>{if(p)finish(p);begin();};
    const ensure=height=>{
      if(!p)begin();
      if(p.y+height>pageBottom)nextPage();
    };
    const sectionHeaderInfo=sec=>{
      if(!p)begin();
      p.ctx.font='23px Arial';
      const lines=sec.desc?pdfTextLines(p.ctx,sec.desc,contentW):[];
      return {lines,height:58+(lines.length?lines.length*31+16:0)};
    };
    const drawSectionTitle=(sec,index,headerInfo)=>{
      const info=headerInfo||sectionHeaderInfo(sec);
      ensure(info.height);
      p.ctx.fillStyle='#101216';p.ctx.beginPath();p.ctx.arc(REPORT_PDF_MARGIN+20,p.y+20,20,0,Math.PI*2);p.ctx.fill();
      p.ctx.fillStyle='#fff';p.ctx.font='bold 18px Arial';p.ctx.textAlign='center';p.ctx.fillText(String(index+1),REPORT_PDF_MARGIN+20,p.y+9);p.ctx.textAlign='left';
      p.ctx.fillStyle='#101216';p.ctx.font='bold 29px Arial';p.ctx.fillText(sec.title||'(sans titre)',REPORT_PDF_MARGIN+58,p.y+4);p.y+=58;
      if(info.lines.length){
        p.ctx.fillStyle='#4b5563';p.ctx.font='23px Arial';
        p.y=pdfDrawLines(p.ctx,info.lines,REPORT_PDF_MARGIN,p.y,31)+16;
      }
      pageHasSection=true;
    };
    const fixedRowImageHeight=(rowsPerPage,captionAndGap)=>{
      const available=Math.max(1,pageBottom-p.y);
      return Math.max(110,Math.floor((available-rowsPerPage*captionAndGap)/rowsPerPage));
    };

    for(let i=0;i<s.sections.length;i++){
      const sec=s.sections[i];normSection(sec);
      if(sec.newpage&&p)nextPage();
      if(!p)begin();

      const fixedRows=Math.max(0,Math.min(4,Number(sec.rowsPerPage)||0));
      const headerInfo=sectionHeaderInfo(sec);
      const symHeaderHeight=sec.type==='sym'?58:0;
      /* Avec un nombre de lignes imposé, évite de commencer une prestation tout
         en bas d'une page déjà occupée : ses photos resteraient lisibles mais
         beaucoup trop petites. La première page "Détail" n'est jamais laissée
         seule, car pageHasSection reste faux tant qu'aucune prestation n'y figure. */
      if(fixedRows&&pageHasSection){
        const estimated=headerInfo.height+symHeaderHeight+fixedRows*(180+62);
        if(p.y+estimated>pageBottom)nextPage();
      }
      drawSectionTitle(sec,i,headerInfo);

      if(sec.type==='sym'){
        const L=sec.photosL||[],R=sec.photosR||[],rows=Math.max(L.length,R.length);
        ensure(58);
        const gap=34,colW=(contentW-gap)/2;
        p.ctx.fillStyle='#101216';pdfRoundRect(p.ctx,REPORT_PDF_MARGIN,p.y,colW,44,7,true,false);pdfRoundRect(p.ctx,REPORT_PDF_MARGIN+colW+gap,p.y,colW,44,7,true,false);
        p.ctx.fillStyle='#fff';p.ctx.font='bold 21px Arial';p.ctx.textAlign='center';
        p.ctx.fillText(sec.labelL||'Gauche',REPORT_PDF_MARGIN+colW/2,p.y+10);p.ctx.fillText(sec.labelR||'Droite',REPORT_PDF_MARGIN+colW+gap+colW/2,p.y+10);p.ctx.textAlign='left';p.y+=58;
        if(!rows){p.ctx.fillStyle='#6b7280';p.ctx.font='italic 22px Arial';p.ctx.fillText('Aucune photo',REPORT_PDF_MARGIN,p.y);p.y+=48;}

        let rowsOnPage=0,fixedImageH=0;
        for(let row=0;row<rows;row++){
          if(fixedRows&&rowsOnPage>=fixedRows){nextPage();rowsOnPage=0;fixedImageH=0;}
          const itemL=L[row],itemR=R[row];
          const imgL=itemL?await loadReportPdfImage(itemL.src,imageCache):null;
          const imgR=itemR?await loadReportPdfImage(itemR.src,imageCache):null;
          const captionReserve=36,rowGap=26;
          let imageH=480;
          if(fixedRows){
            if(rowsOnPage===0)fixedImageH=fixedRowImageHeight(fixedRows,captionReserve+rowGap);
            imageH=fixedImageH;
            if(p.y+imageH+captionReserve+rowGap>pageBottom){nextPage();rowsOnPage=0;fixedImageH=fixedRowImageHeight(fixedRows,captionReserve+rowGap);imageH=fixedImageH;}
          }else{
            ensure(imageH+(itemL?.cap||itemR?.cap?captionReserve:0)+rowGap);
          }
          pdfDrawContain(p.ctx,imgL,REPORT_PDF_MARGIN,p.y,colW,imageH,{border:true,background:'#fafbfc'});
          pdfDrawContain(p.ctx,imgR,REPORT_PDF_MARGIN+colW+gap,p.y,colW,imageH,{border:true,background:'#fafbfc'});
          if(itemL?.cap){p.ctx.fillStyle='#6b7280';p.ctx.font='19px Arial';p.ctx.textAlign='center';p.ctx.fillText(itemL.cap,REPORT_PDF_MARGIN+colW/2,p.y+imageH+8);}
          if(itemR?.cap){p.ctx.fillStyle='#6b7280';p.ctx.font='19px Arial';p.ctx.textAlign='center';p.ctx.fillText(itemR.cap,REPORT_PDF_MARGIN+colW+gap+colW/2,p.y+imageH+8);}
          p.ctx.textAlign='left';
          p.y+=imageH+(fixedRows?captionReserve:(itemL?.cap||itemR?.cap?captionReserve:0))+rowGap;
          rowsOnPage++;pageHasSection=true;
        }
      }else{
        const photos=sec.photos||[],cols=Math.max(1,Math.min(6,Number(sec.cols)||2));
        const gap=22,colW=(contentW-gap*(cols-1))/cols;
        const autoImageH={1:820,2:500,3:340,4:250,5:205,6:170}[cols];
        let rowsOnPage=0,fixedImageH=0;
        for(let start=0;start<photos.length;start+=cols){
          if(fixedRows&&rowsOnPage>=fixedRows){nextPage();rowsOnPage=0;fixedImageH=0;}
          const row=photos.slice(start,start+cols);
          const captionReserve=36,rowGap=26;
          let imageH=autoImageH;
          if(fixedRows){
            if(rowsOnPage===0)fixedImageH=fixedRowImageHeight(fixedRows,captionReserve+rowGap);
            imageH=fixedImageH;
            if(p.y+imageH+captionReserve+rowGap>pageBottom){nextPage();rowsOnPage=0;fixedImageH=fixedRowImageHeight(fixedRows,captionReserve+rowGap);imageH=fixedImageH;}
          }else{
            ensure(imageH+(row.some(x=>x.cap)?captionReserve:0)+rowGap);
          }
          for(let j=0;j<row.length;j++){
            const item=row[j],img=await loadReportPdfImage(item.src,imageCache),x=REPORT_PDF_MARGIN+j*(colW+gap);
            pdfDrawContain(p.ctx,img,x,p.y,colW,imageH,{border:true,background:'#fafbfc'});
            if(item.cap){p.ctx.fillStyle='#6b7280';p.ctx.font='18px Arial';p.ctx.textAlign='center';p.ctx.fillText(item.cap,x+colW/2,p.y+imageH+8);p.ctx.textAlign='left';}
          }
          p.y+=imageH+(fixedRows?captionReserve:(row.some(x=>x.cap)?captionReserve:0))+rowGap;
          rowsOnPage++;pageHasSection=true;
        }
      }
      p.y+=24;
    }
    if(p)finish(p);
  }

  /* Recommandations, étiquette et points de contrôle */
  const checked=(s.checkpoints||[]).filter(cp=>cp.checked);
  if(s.closing||s.labelR||s.labelV||checked.length){
    const p=contentPage('Recommandations et contrôles'),ctx=p.ctx;
    if(s.closing){
      ctx.fillStyle='#fafbfd';ctx.strokeStyle='#d9dde4';ctx.lineWidth=2;pdfRoundRect(ctx,REPORT_PDF_MARGIN,p.y,contentW,150,10,true,true);
      ctx.fillStyle='#101216';ctx.font='bold 22px Arial';ctx.fillText('RECOMMANDATIONS / PROCHAINE RÉVISION',REPORT_PDF_MARGIN+24,p.y+20);
      ctx.fillStyle='#4b5563';ctx.font='22px Arial';const lines=pdfTextLines(ctx,s.closing,contentW-48);pdfDrawLines(ctx,lines,REPORT_PDF_MARGIN+24,p.y+58,29,3);p.y+=176;
    }
    if(s.labelR||s.labelV){
      const items=[s.labelR,s.labelV].filter(Boolean),gap=28,w=(contentW-gap*(items.length-1))/items.length,h=520;
      for(let i=0;i<items.length;i++){
        const img=await loadReportPdfImage(items[i],imageCache);pdfDrawContain(ctx,img,REPORT_PDF_MARGIN+i*(w+gap),p.y,w,h,{border:true,background:'#fafbfc'});
      }
      p.y+=h+35;
    }
    if(checked.length){
      ctx.font='bold 27px Arial';ctx.fillStyle='#101216';ctx.fillText('Points de contrôle',REPORT_PDF_MARGIN,p.y);p.y+=46;
      for(const cp of checked){
        const lines=pdfTextLines(ctx,cp.label,contentW-105),h=Math.max(58,20+lines.length*27);
        if(p.y+h>REPORT_PDF_H-REPORT_PDF_MARGIN)break;
        ctx.fillStyle='#f3f9f4';ctx.strokeStyle='#bfe3c4';pdfRoundRect(ctx,REPORT_PDF_MARGIN,p.y,contentW,h,8,true,true);
        ctx.fillStyle='#101216';ctx.fillRect(REPORT_PDF_MARGIN+18,p.y+15,30,30);ctx.fillStyle='#fff';ctx.font='bold 20px Arial';ctx.fillText('✓',REPORT_PDF_MARGIN+24,p.y+18);
        ctx.fillStyle='#374151';ctx.font='21px Arial';pdfDrawLines(ctx,lines,REPORT_PDF_MARGIN+70,p.y+15,27);p.y+=h+13;
      }
    }
    finish(p);
  }

  /* Entretien baie moteur */
  if(s.baieOn&&(s.baieAvant||s.baieApres)){
    const p=contentPage((s.baieTitle&&s.baieTitle.trim())?s.baieTitle.trim():'Entretien baie moteur');
    const items=[];if(s.baieAvant)items.push(['Avant',s.baieAvant]);if(s.baieApres)items.push(['Après',s.baieApres]);
    const h=items.length===1?1250:590;
    for(const [label,src] of items){
      const img=await loadReportPdfImage(src,imageCache);pdfDrawContain(p.ctx,img,REPORT_PDF_MARGIN,p.y,contentW,h,{border:true,background:'#fafbfc'});
      p.ctx.fillStyle='#101216';p.ctx.font='bold 22px Arial';p.ctx.textAlign='center';p.ctx.fillText(label.toUpperCase(),REPORT_PDF_W/2,p.y+h+8);p.ctx.textAlign='left';p.y+=h+50;
    }
    finish(p);
  }

  /* Factures */
  if(s.invoicesOn&&s.invoices.length){
    for(const inv of s.invoices){
      const p=newCanvas();drawWatermark(p);
      if(inv.kind==='pdf'){
        p.ctx.fillStyle='#101216';p.ctx.font='bold 34px Arial';p.ctx.fillText('Facture des pièces',REPORT_PDF_MARGIN,p.y);p.y+=70;
        p.ctx.fillStyle='#6b7280';p.ctx.font='24px Arial';p.ctx.fillText('Cette facture PDF doit être réimportée sous forme d’image.',REPORT_PDF_MARGIN,p.y);
      }else{
        const img=await loadReportPdfImage(inv.src,imageCache);pdfDrawContain(p.ctx,img,REPORT_PDF_MARGIN,REPORT_PDF_MARGIN,contentW,REPORT_PDF_H-REPORT_PDF_MARGIN*2,{background:'#fff'});
      }
      finish(p);
    }
  }
  return pages;
}


  async function downloadReportPdf(state,options={}){
    storage=options.storage||null;
    const pages=await renderReportPdfPages(state,{
      imageCache:options.imageCache||new Map(),
      defaultLogo:options.defaultLogo||'report-cover-logo.png'
    });
    if(!pages.length) throw new Error('Aucune page générée');
    const blob=buildReportImagePdf(pages);
    const url=URL.createObjectURL(blob);
    try{
      const link=document.createElement('a');
      link.href=url;
      link.download=reportPdfFilename(state);
      link.rel='noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }finally{
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    return blob;
  }

  global.WBReportPdf={
    download:downloadReportPdf,
    renderPages:renderReportPdfPages,
    buildPdf:buildReportImagePdf,
    filename:reportPdfFilename
  };
})(window);
