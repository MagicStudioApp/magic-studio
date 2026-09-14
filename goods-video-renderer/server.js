import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import cors from 'cors';
import express from 'express';
import {chromium} from 'playwright';

const app = express();
const port = Number(process.env.PORT || 8080);
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const retentionMs = Math.max(15 * 60 * 1000, Number(process.env.RETENTION_MS || 24 * 60 * 60 * 1000));
const maxJobsPerHour = Math.max(1, Number(process.env.MAX_JOBS_PER_HOUR || 10));
const allowedOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || 'https://magicstudioapp.github.io')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);
const jobs = new Map();
const requestHistory = new Map();
let queue = Promise.resolve();

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin) || (process.env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin not allowed'));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  credentials: false
}));
app.use(express.json({limit: '256kb'}));

function publicJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error || undefined,
    downloadUrl: job.status === 'completed' ? `/api/goods-video-jobs/${job.id}/download` : undefined,
    expiresAt: job.expiresAt ? new Date(job.expiresAt).toISOString() : undefined
  };
}

function validateCloudinaryUrl(value) {
  if (!value) return;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || !url.pathname.startsWith('/dyvmftiyu/')) {
    throw new Error('Invalid image URL');
  }
}

function validateSourceUrl(value) {
  const source = new URL(String(value || ''));
  if (source.protocol !== 'https:' || source.hostname !== 'magicstudioapp.github.io' || source.pathname !== '/magic-studio/goods-video.html') {
    throw new Error('Invalid Goods video URL');
  }
  if (source.href.length > 120_000) throw new Error('Goods video URL is too large');
  const count = Number(source.searchParams.get('figure_count') || 1);
  if (!Number.isInteger(count) || count < 1 || count > 15) throw new Error('Invalid product count');
  if ((source.searchParams.get('series_text') || '').length > 500) throw new Error('Video text is too long');
  for (const [key, value] of source.searchParams) {
    if (key === 'bg_url' || key === 'background_reference_url' || /^figure\d+_url$/.test(key) || /^left[1-3]_url$/.test(key)) {
      validateCloudinaryUrl(value);
    }
  }
  return source.href;
}

function validatePayload(body) {
  return {
    sourceUrl: validateSourceUrl(body.url),
    filename: String(body.filename || 'magic-studio-goods.mp4').replace(/[^a-z0-9._-]/gi, '-').slice(0, 120)
  };
}

function rateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const cutoff = Date.now() - 60 * 60 * 1000;
  const recent = (requestHistory.get(key) || []).filter(time => time > cutoff);
  if (recent.length >= maxJobsPerHour) {
    res.status(429).json({error: 'Video export limit reached. Please try again later.'});
    return;
  }
  recent.push(Date.now());
  requestHistory.set(key, recent);
  next();
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'ignore', 'pipe'], ...options});
    let error = '';
    child.stderr.on('data', chunk => { error += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}: ${error.slice(-2000)}`)));
  });
}

async function render(job, payload) {
  if (job.cancelled) throw new DOMException('Render cancelled', 'AbortError');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `goods-video-${job.id}-`));
  const outputPath = path.join(directory, 'output.mp4');
  job.directory = directory;
  job.status = 'rendering';
  job.progress = 2;
  const browser = await chromium.launch({headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox']});
  try {
    const page = await browser.newPage({viewport: {width: 1080, height: 1920}, deviceScaleFactor: 1});
    await page.goto(payload.sourceUrl, {waitUntil: 'networkidle', timeout: 60_000});
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.complete ? undefined : new Promise(resolve => {
        image.onload = image.onerror = resolve;
      })));
    });
    const totalFrames = 100;
    for (let frame = 0; frame < totalFrames; frame++) {
      if (job.cancelled) throw new DOMException('Render cancelled', 'AbortError');
      const time = frame * 50;
      await page.evaluate(value => {
        document.getAnimations({subtree: true}).forEach(animation => {
          animation.pause();
          animation.currentTime = value;
        });
      }, time);
      await page.screenshot({
        path: path.join(directory, `frame-${String(frame).padStart(6, '0')}.jpg`),
        type: 'jpeg',
        quality: 92
      });
      job.progress = Math.round(5 + ((frame + 1) / totalFrames) * 75);
    }
  } finally {
    await browser.close();
  }
  if (job.cancelled) throw new DOMException('Render cancelled', 'AbortError');
  job.status = 'encoding';
  job.progress = 84;
  await run(ffmpegPath, [
    '-y', '-framerate', '20', '-i', path.join(directory, 'frame-%06d.jpg'),
    '-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath
  ], {signal: job.abortController.signal});
  const entries = await fs.readdir(directory);
  await Promise.all(entries.filter(name => name.startsWith('frame-')).map(name => fs.unlink(path.join(directory, name))));
  job.outputPath = outputPath;
  job.filename = payload.filename.endsWith('.mp4') ? payload.filename : `${payload.filename}.mp4`;
  job.status = 'completed';
  job.progress = 100;
  job.expiresAt = Date.now() + retentionMs;
}

function enqueue(job, payload) {
  queue = queue.then(() => job.cancelled ? undefined : render(job, payload)).catch(async error => {
    if (job.cancelled || error?.name === 'AbortError') {
      job.status = 'cancelled';
    } else {
      job.status = 'failed';
      job.error = 'La génération vidéo a échoué. Réessayez dans un instant.';
      console.error('Goods video job failed:', error);
    }
    if (job.directory && job.status !== 'completed') await fs.rm(job.directory, {recursive: true, force: true}).catch(() => {});
  });
}

app.get('/api/health', (req, res) => res.json({ok: true, service: 'magic-studio-goods-video', queued: [...jobs.values()].filter(job => ['queued', 'rendering', 'encoding'].includes(job.status)).length}));

app.post('/api/goods-video-jobs', rateLimit, (req, res) => {
  try {
    const payload = validatePayload(req.body);
    const id = crypto.randomUUID();
    const job = {id, status: 'queued', progress: 0, createdAt: Date.now(), cancelled: false, abortController: new AbortController()};
    jobs.set(id, job);
    enqueue(job, payload);
    res.status(202).json(publicJob(job));
  } catch (error) {
    res.status(400).json({error: error.message});
  }
});

app.get('/api/goods-video-jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({error: 'Job not found'});
  res.json(publicJob(job));
});

app.delete('/api/goods-video-jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({error: 'Job not found'});
  if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
    job.cancelled = true;
    job.status = 'cancelled';
    job.abortController.abort();
  }
  res.json(publicJob(job));
});

app.get('/api/goods-video-jobs/:id/download', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'completed') return res.status(404).json({error: 'Video is not available'});
  res.download(job.outputPath, job.filename);
});

setInterval(async () => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const expired = job.expiresAt && job.expiresAt <= now;
    const abandoned = ['failed', 'cancelled'].includes(job.status) && now - job.createdAt > 60 * 60 * 1000;
    if (!expired && !abandoned) continue;
    if (job.directory) await fs.rm(job.directory, {recursive: true, force: true}).catch(() => {});
    jobs.delete(id);
  }
  for (const [key, times] of requestHistory) {
    const recent = times.filter(time => time > now - 60 * 60 * 1000);
    if (recent.length) requestHistory.set(key, recent);
    else requestHistory.delete(key);
  }
}, 10 * 60 * 1000).unref();

app.use((error, req, res, next) => {
  if (error?.message === 'Origin not allowed') {
    res.status(403).json({error: 'Origin not allowed'});
    return;
  }
  next(error);
});

app.listen(port, '0.0.0.0', () => console.log(`Magic Studio Goods video renderer listening on ${port}`));
