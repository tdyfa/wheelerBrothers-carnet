'use strict';
/* Common PDF assembler. Page artwork stays lightweight; photographs are separate
   image objects at their source resolution. Sources are read sequentially. */
(function(global){
  const enc=new TextEncoder();
  function jpegInfo(a){
    if(a[0]!==255||a[1]!==216)return null;
    let p=2, orientation=1, info=null;
    while(p+4<a.length){
      if(a[p++]!==255)continue;
      let m=a[p++]; while(m===255)m=a[p++];
      if(m===217||m===218)break;
      if(m===1||(m>=208&&m<=215))continue;
      const n=(a[p]<<8)|a[p+1], start=p+2, end=p+n;
      if(n<2||end>a.length)break;
      if(m===225&&n>=16&&String.fromCharCode(...a.slice(start,start+6))==='Exif\0\0'){
        try{
          const b=start+6, le=a[b]===73&&a[b+1]===73, be=a[b]===77&&a[b+1]===77;
          if(le||be){
            const view=new DataView(a.buffer,a.byteOffset,a.byteLength);
            const u16=o=>view.getUint16(o,le),u32=o=>view.getUint32(o,le);
            const dir=b+u32(b+4), count=u16(dir);
            for(let i=0;i<count;i++){const q=dir+2+i*12;if(u16(q)===274&&u16(q+2)===3&&u32(q+4)>=1){orientation=u16(q+8);break;}}
          }
        }catch(_){throw new Error('Métadonnées JPEG illisibles.');}
      }
      if([192,193,194].includes(m)&&n>=8)info={height:(a[start+1]<<8)|a[start+2],width:(a[start+3]<<8)|a[start+4],components:a[start+5]};
      p=end;
    }
    if(!info||!info.width||!info.height||![1,3].includes(info.components))throw new Error('JPEG incompatible avec le PDF (dimensions ou couleurs non prises en charge).');
    info.orientation=orientation>=1&&orientation<=8?orientation:1;
    return info;
  }
  async function encodedPixels(blob){
    let image, url, canvas;
    // PNG exposes its dimensions in IHDR: reject oversized images before decode.
    const header=new Uint8Array(await blob.slice(0,24).arrayBuffer());
    if(header.length>=24 && header[0]===137 && header[1]===80 && header[2]===78 && header[3]===71){
      const v=new DataView(header.buffer,header.byteOffset,header.byteLength);
      if(v.getUint32(16)*v.getUint32(20)>12500000)throw new Error('Image non JPEG trop grande pour ce moteur PDF (limite : 12,5 mégapixels). Une copie compatible de taille adaptée est nécessaire.');
    }
    try{
      if(global.createImageBitmap)image=await global.createImageBitmap(blob,{imageOrientation:'from-image'});
      else{
        url=URL.createObjectURL(blob);
        image=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Image illisible pour le PDF.'));im.src=url;});
      }
      const w=image.width,h=image.height;
      if(!w||!h||w*h>12500000)throw new Error('Image non JPEG trop grande pour ce moteur PDF (limite : 12,5 mégapixels). Une copie compatible de taille adaptée est nécessaire.');
      canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
      const rgba=ctx.getImageData(0,0,w,h).data, rgb=new Uint8Array(w*h*3),alpha=new Uint8Array(w*h);
      let transparent=false;
      for(let i=0,j=0;i<rgba.length;i+=4,j++){rgb[j*3]=rgba[i];rgb[j*3+1]=rgba[i+1];rgb[j*3+2]=rgba[i+2];alpha[j]=rgba[i+3];if(alpha[j]!==255)transparent=true;}
      async function pack(data){
        if(typeof global.CompressionStream!=='function')return {bytes:data,filter:''};
        const stream=new Blob([data]).stream().pipeThrough(new global.CompressionStream('deflate'));
        return {bytes:new Uint8Array(await new Response(stream).arrayBuffer()),filter:'/Filter /FlateDecode'};
      }
      const color=await pack(rgb),mask=transparent?await pack(alpha):null;
      return {width:w,height:h,color,mask};
    }finally{
      if(image&&typeof image.close==='function')image.close();
      if(url)URL.revokeObjectURL(url);
      if(canvas){canvas.width=0;canvas.height=0;}
    }
  }
  async function build(pages,{sourceAsBlob,onProgress}={}){
    if(typeof sourceAsBlob!=='function')throw new Error('Chargeur photo PDF absent.');
    const W=595.28,H=841.89,chunks=[],offsets=[0];let length=0,nextId=3;
    function add(x){if(typeof x==='string')x=enc.encode(x);chunks.push(x);length+=x.size===undefined?x.length:x.size;}
    function object(id,body){offsets[id]=length;add(`${id} 0 obj\n`);body();add('\nendobj\n');}
    function stream(id,dict,bytes){object(id,()=>{add(`<< ${dict} /Length ${bytes.size===undefined?bytes.length:bytes.size} >>\nstream\n`);add(bytes);add('\nendstream');});}
    add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    object(1,()=>add('<< /Type /Catalog /Pages 2 0 R >>'));
    const pageIds=pages.map(()=>nextId++);
    object(2,()=>add(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`));
    const seen=new Map();
    async function imageObject(blob){
      const head=new Uint8Array(await blob.slice(0,1048576).arrayBuffer()), jpeg=jpegInfo(head);
      if(jpeg){
        const id=nextId++;
        stream(id,`/Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace /Device${jpeg.components===1?'Gray':'RGB'} /BitsPerComponent 8 /Filter /DCTDecode`,blob);
        return {id,orientation:jpeg.orientation};
      }
      const im=await encodedPixels(blob);let maskId=null;
      if(im.mask){maskId=nextId++;stream(maskId,`/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceGray /BitsPerComponent 8 ${im.mask.filter}`,im.mask.bytes);}
      const id=nextId++;
      stream(id,`/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${im.color.filter}${maskId?` /SMask ${maskId} 0 R`:''}`,im.color.bytes);
      return {id,orientation:1};
    }
    const matrices=[[1,0,0,1,0,0],[-1,0,0,1,1,0],[-1,0,0,-1,1,1],[1,0,0,-1,0,1],[0,-1,-1,0,1,1],[0,-1,1,0,0,1],[0,1,1,0,0,0],[0,1,-1,0,1,0]];
    for(let i=0;i<pages.length;i++){
      const page=pages[i], bgBlob=await (await fetch(page.dataUrl)).blob(), bg=await imageObject(bgBlob);
      const resources=[`/Bg ${bg.id} 0 R`], commands=[`q ${W} 0 0 ${H} 0 0 cm /Bg Do Q`];
      for(let j=0;j<(page.overlays||[]).length;j++){
        const overlay=page.overlays[j];let item=seen.get(overlay.src);
        if(!item){const blob=await sourceAsBlob(overlay.src);if(!blob||!blob.size)throw new Error('Photo source vide pour le PDF.');item=await imageObject(blob);seen.set(overlay.src,item);}
        const name=`I${j}`,sx=W/page.width,sy=H/page.height;
        const x=overlay.x*sx,y=H-(overlay.y+overlay.h)*sy,w=overlay.w*sx,h=overlay.h*sy;
        resources.push(`/${name} ${item.id} 0 R`);
        commands.push(`q ${w} 0 0 ${h} ${x} ${y} cm ${matrices[item.orientation-1].join(' ')} cm /${name} Do Q`);
      }
      const content=enc.encode(commands.join('\n')),contentId=nextId++;
      stream(contentId,'',content);
      object(pageIds[i],()=>add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << ${resources.join(' ')} >> >> /Contents ${contentId} 0 R >>`));
      if(onProgress)onProgress(i+1,pages.length);
    }
    const xref=length;add(`xref\n0 ${nextId}\n0000000000 65535 f \n`);
    for(let i=1;i<nextId;i++){if(offsets[i]===undefined)throw new Error('PDF incomplet.');add(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);}
    add(`trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(chunks,{type:'application/pdf'});
  }
  // Incremental variant: append one completed page at a time. The original
  // source loader may therefore release each page's temporary input blobs as
  // soon as addPage resolves. The final PDF chunks still occupy memory.
  function createIncremental({sourceAsBlob}={}){
    if(typeof sourceAsBlob!=='function')throw new Error('Chargeur photo PDF absent.');
    const W=595.28,H=841.89;
    let chunks=[],offsets=[0],length=0,nextId=3,state='active',busy=false;
    const pageIds=[],seen=new Map();
    const ensureActive=()=>{if(state!=='active')throw new Error('Assemblage PDF interrompu.');};
    function add(x){ensureActive();if(typeof x==='string')x=enc.encode(x);chunks.push(x);length+=x.size===undefined?x.length:x.size;}
    function object(id,body){ensureActive();offsets[id]=length;add(`${id} 0 obj\n`);body();add('\nendobj\n');}
    function stream(id,dict,bytes){object(id,()=>{add(`<< ${dict} /Length ${bytes.size===undefined?bytes.length:bytes.size} >>\nstream\n`);add(bytes);add('\nendstream');});}
    function release(){chunks=[];offsets=[];pageIds.length=0;seen.clear();length=0;}
    add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    object(1,()=>add('<< /Type /Catalog /Pages 2 0 R >>'));
    const matrices=[[1,0,0,1,0,0],[-1,0,0,1,1,0],[-1,0,0,-1,1,1],[1,0,0,-1,0,1],[0,-1,-1,0,1,1],[0,-1,1,0,0,1],[0,1,1,0,0,0],[0,1,-1,0,1,0]];
    async function imageObject(blob){
      const head=new Uint8Array(await blob.slice(0,1048576).arrayBuffer());ensureActive();
      const jpeg=jpegInfo(head);
      if(jpeg){
        const id=nextId++;
        stream(id,`/Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace /Device${jpeg.components===1?'Gray':'RGB'} /BitsPerComponent 8 /Filter /DCTDecode`,blob);
        return {id,orientation:jpeg.orientation};
      }
      const im=await encodedPixels(blob);ensureActive();let maskId=null;
      if(im.mask){maskId=nextId++;stream(maskId,`/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceGray /BitsPerComponent 8 ${im.mask.filter}`,im.mask.bytes);}
      const id=nextId++;
      stream(id,`/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${im.color.filter}${maskId?` /SMask ${maskId} 0 R`:''}`,im.color.bytes);
      return {id,orientation:1};
    }
    // Called only after the renderer has successfully decoded a photograph
    // which it intends to place as an overlay. The original file becomes part
    // of the eventual PDF immediately; the seen map itself stores just IDs.
    async function ensureImage(src,blob){
      ensureActive();if(busy)throw new Error('Une page PDF est déjà en cours.');
      if(typeof src!=='string'||!src||!blob||!blob.size)throw new Error('Photo source vide pour le PDF.');
      if(seen.has(src))return;
      busy=true;
      try{const item=await imageObject(blob);ensureActive();seen.set(src,item);}
      catch(error){state='failed';release();throw error;}
      finally{busy=false;}
    }
    async function addPage(page){
      ensureActive();if(busy)throw new Error('Une page PDF est déjà en cours.');
      if(!page||!page.width||!page.height||!page.dataUrl)throw new Error('Page PDF invalide.');
      busy=true;
      try{
        const pageId=nextId++;
        const bgResponse=await fetch(page.dataUrl);ensureActive();
        const bgBlob=await bgResponse.blob();ensureActive();
        const bg=await imageObject(bgBlob);ensureActive();
        const resources=[`/Bg ${bg.id} 0 R`],commands=[`q ${W} 0 0 ${H} 0 0 cm /Bg Do Q`];
        for(let j=0;j<(page.overlays||[]).length;j++){
          const overlay=page.overlays[j];let item=seen.get(overlay.src);
          if(!item){
            const blob=await sourceAsBlob(overlay.src);ensureActive();
            if(!blob||!blob.size)throw new Error('Photo source vide pour le PDF.');
            item=await imageObject(blob);ensureActive();seen.set(overlay.src,item);
          }
          const name=`I${j}`,sx=W/page.width,sy=H/page.height;
          const x=overlay.x*sx,y=H-(overlay.y+overlay.h)*sy,w=overlay.w*sx,h=overlay.h*sy;
          resources.push(`/${name} ${item.id} 0 R`);
          commands.push(`q ${w} 0 0 ${h} ${x} ${y} cm ${matrices[item.orientation-1].join(' ')} cm /${name} Do Q`);
        }
        const content=enc.encode(commands.join('\n')),contentId=nextId++;
        stream(contentId,'',content);
        object(pageId,()=>add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << ${resources.join(' ')} >> >> /Contents ${contentId} 0 R >>`));
        pageIds.push(pageId);
      }catch(error){state='failed';release();throw error;}
      finally{busy=false;}
    }
    async function finish(){
      ensureActive();if(busy)throw new Error('Une page PDF est déjà en cours.');
      if(!pageIds.length)throw new Error('Aucune page générée.');
      try{
        object(2,()=>add(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`));
        const xref=length;add(`xref\n0 ${nextId}\n0000000000 65535 f \n`);
        for(let i=1;i<nextId;i++){if(offsets[i]===undefined)throw new Error('PDF incomplet.');add(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);}
        add(`trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
        const result=new Blob(chunks,{type:'application/pdf'});state='finished';release();return result;
      }catch(error){state='failed';release();throw error;}
    }
    function abort(){if(state==='active'){state='aborted';release();}}
    return {ensureImage,addPage,finish,abort};
  }
  global.WBPDFWriter={build,createIncremental};
})(window);
