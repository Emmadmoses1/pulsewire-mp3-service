const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({limit:'1mb'}));

function run(command,args){
  return new Promise((resolve,reject)=>{
    const p=spawn(command,args);
    let stdout='';
    let stderr='';

    p.stdout.on('data',d=>stdout+=d.toString());
    p.stderr.on('data',d=>stderr+=d.toString());

    p.on('error',reject);

    p.on('close',code=>{
      if(code===0) resolve({stdout,stderr});
      else reject(new Error(stderr.slice(-5000)||('Process exited with code '+code)));
    });
  });
}

function safeName(s){
  return String(s||'audio')
    .replace(/[<>:"/\\\\|?*\\x00-\\x1F]/g,'')
    .replace(/\\s+/g,' ')
    .trim()
    .slice(0,120) || 'audio';
}

function isYouTubeUrl(value){
  try{
    const u=new URL(value);
    const host=u.hostname.toLowerCase().replace(/^www\./, '');
    return host==='youtube.com' ||
           host==='m.youtube.com' ||
           host==='music.youtube.com' ||
           host==='youtu.be';
  }catch{
    return false;
  }
}

async function downloadCover(url,file){
  if(!url) return false;

  try{
    const u=new URL(url);

    if(!['http:','https:'].includes(u.protocol)) return false;

    const res=await fetch(u,{
      headers:{'User-Agent':'Mozilla/5.0'}
    });

    if(!res.ok) return false;

    const type=(res.headers.get('content-type')||'').toLowerCase();

    if(!type.startsWith('image/')) return false;

    const buf=Buffer.from(await res.arrayBuffer());

    if(buf.length>8*1024*1024) return false;

    fs.writeFileSync(file,buf);
    return true;
  }catch{
    return false;
  }
}

app.get('/health',(req,res)=>{
  res.json({ok:true,service:'pulsewire-mp3'});
});

app.post('/convert',async(req,res)=>{
  const {
    url,
    artist='',
    title='',
    track='',
    year='',
    genre='',
    coverUrl=''
  }=req.body||{};

  if(!url){
    return res.status(400).json({error:'YouTube URL is required.'});
  }

  if(!isYouTubeUrl(url)){
    return res.status(400).json({error:'Only YouTube URLs are accepted.'});
  }

  /*
    This endpoint is intended only for media the operator has
    permission to download and redistribute.
  */

  const id=crypto.randomBytes(10).toString('hex');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulsewire-'+id+'-'));

  const source=path.join(dir,'source.%(ext)s');
  const input=path.join(dir,'source');
  const output=path.join(dir,'pulsewire.mp3');
  const cover=path.join(dir,'cover.jpg');

  try{
    console.log('Downloading authorized YouTube media:',url);

    await run('yt-dlp',[
      '--no-playlist',
      '--no-warnings',
      '--restrict-filenames',
      '-f','bestaudio/best',
      '-o',source,
      url
    ]);

    const files=fs.readdirSync(dir)
      .filter(x=>x.startsWith('source.') && !x.endsWith('.part'));

    if(!files.length){
      throw new Error('YouTube media was not downloaded.');
    }

    const downloaded=path.join(dir,files[0]);

    let hasCover=false;

    if(coverUrl){
      hasCover=await downloadCover(coverUrl,cover);
    }

    const ffArgs=[
      '-y',
      '-i',downloaded
    ];

    if(hasCover){
      ffArgs.push(
        '-i',cover,
        '-map','0:a:0',
        '-map','1:v:0',
        '-c:v','mjpeg',
        '-disposition:v:attached_pic'
      );
    }else{
      ffArgs.push(
        '-map','0:a:0'
      );
    }

    ffArgs.push(
      '-c:a','libmp3lame',
      '-b:a','320k',
      '-ar','44100',
      '-metadata',`album=PulseWire`
    );

    if(artist) ffArgs.push('-metadata',`artist=${artist}`);
    if(title) ffArgs.push('-metadata',`title=${title}`);
    if(track) ffArgs.push('-metadata',`track=${track}`);
    if(year) ffArgs.push('-metadata',`date=${year}`);
    if(genre) ffArgs.push('-metadata',`genre=${genre}`);

    ffArgs.push(output);

    await run('ffmpeg',ffArgs);

    if(!fs.existsSync(output)){
      throw new Error('MP3 conversion failed.');
    }

    const filename=safeName(
      `${artist ? artist+' - ' : ''}${title || 'PulseWire Song'}`
    )+'.mp3';

    res.setHeader('Content-Type','audio/mpeg');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/"/g,'')}"`

    );

    fs.createReadStream(output).pipe(res);

    res.on('finish',()=>{
      fs.rmSync(dir,{recursive:true,force:true});
    });

    res.on('close',()=>{
      if(fs.existsSync(dir)){
        fs.rmSync(dir,{recursive:true,force:true});
      }
    });

  }catch(error){
    console.error(error);

    if(fs.existsSync(dir)){
      fs.rmSync(dir,{recursive:true,force:true});
    }

    res.status(500).json({
      error:'Conversion failed.',
      detail:error.message
    });
  }
});

const PORT=process.env.PORT||10000;

app.listen(PORT,()=>{
  console.log(`PulseWire MP3 service running on port ${PORT}`);
});
