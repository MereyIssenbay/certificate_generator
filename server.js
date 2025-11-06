const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');
const { v4: uuidv4 } = require('uuid');
const dayjs = require('dayjs');
const app = express();
app.use(express.json());
const upload = multer({ dest: 'templates/' });
const TEMPLATES_FILE = path.join(__dirname, 'templates', 'templates.json');
const OUT_DIR = path.join(__dirname, 'out');
const LOG_CSV = path.join(__dirname, 'logs', 'certificates.csv');
const LOG_JSONL = path.join(__dirname, 'logs', 'certificates.jsonl');

// ensure output and log directories exist
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(LOG_CSV))) fs.mkdirSync(path.dirname(LOG_CSV),
{ recursive: true });
// helper: ensure templates.json exists
if (!fs.existsSync(TEMPLATES_FILE)) {
fs.writeFileSync(TEMPLATES_FILE, JSON.stringify({ templates: {} }, null, 2));
}
function slugify(text) {
return text.toString().toLowerCase()
.normalize('NFKD').replace(/\p{Diacritic}/gu, '')
.replace(/[^a-z0-9 ]/g, '')
.trim().replace(/\s+/g, '-');
}
function rnd4() {
return Math.random().toString(36).substring(2, 6);
}
// Fit text into box: reduce font size and wrap by words
function fitAndRenderText(ctx, text, box, baseFont = '48px sans-serif',
align='center'){
// box: {x,y,w,h}
let fontSize = parseInt(baseFont.match(/(\d+)px/)[1]);
const fontFamily = baseFont.replace(/\d+px\s*/,'') || 'sans-serif';
ctx.textAlign = align;
ctx.textBaseline = 'top';
// wrap function
function wrapLines(font) {
ctx.font = font;
const words = text.split(/\s+/);
const lines = [];
let line = '';
for (const w of words) {
const test = line ? (line + ' ' + w) : w;
const width = ctx.measureText(test).width;
if (width > box.w && line) {
lines.push(line);
line = w;
} else {
line = test;
}
}
if (line) lines.push(line);
4
return lines;
}
// reduce font until it fits vertically
let lines = wrapLines(`${fontSize}px ${fontFamily}`);
while (lines.length * (fontSize * 1.15) > box.h && fontSize > 8) {
fontSize -= 2;
lines = wrapLines(`${fontSize}px ${fontFamily}`);
}
// final render
ctx.font = `${fontSize}px ${fontFamily}`;
const lineHeight = fontSize * 1.15;
let startY = box.y;
// if centered vertically
if (lines.length * lineHeight < box.h) {
startY = box.y + (box.h - lines.length * lineHeight) / 2;
}
let x;
if (align === 'center') x = box.x + box.w/2;
else if (align === 'right') x = box.x + box.w;
else x = box.x;
for (let i=0;i<lines.length;i++){
ctx.fillText(lines[i], x, startY + i*lineHeight);
}
}
// Upload template (PNG/JPG)
app.post('/upload-template', upload.single('template'), async (req, res) => {
try {
const file = req.file;
if (!file) return res.status(400).send('No file');
const dest = path.join(__dirname, 'templates', file.originalname);
fs.renameSync(file.path, dest);
// initial entry in templates.json
const templates = JSON.parse(fs.readFileSync(TEMPLATES_FILE));
templates.templates[file.originalname] = {
version: dayjs().format('YYYYMMDDHHmmss'),
hash: 'v1',
fields: {}
};
fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
res.json({ ok: true, filename: file.originalname });
} catch (err) {
5
console.error(err);
res.status(500).send(String(err));
}
});
// Generate certificates endpoint
app.post('/generate', async (req, res) => {
try {
const { template, name, courses, idPrefix } = req.body;
if (!template || !name || !courses || !Array.isArray(courses) ||
courses.length===0) {
return res.status(400).send('template, name and courses[] required');
}
const templates = JSON.parse(fs.readFileSync(TEMPLATES_FILE));
const tpl = templates.templates[template];
if (!tpl) return res.status(400).send('template not found');
const imgPath = path.join(__dirname, 'templates', template);
const img = await loadImage(imgPath);
const outputs = [];
for (const course of courses) {
const canv = createCanvas(img.width, img.height);
const ctx = canv.getContext('2d');
ctx.drawImage(img, 0, 0);
// draw fields
const idSuffix = rnd4();
const today = dayjs().format('YYYYMMDD');
const id = `${idPrefix || 'CERT-'}${today}-${idSuffix}`;
// ensure fields exist in template.json; fallback areas if not
const nameBox = tpl.fields.name || { x: 100, y: 300, w: img.width-200, h:
120, align: 'center', font: '24px sans-serif' };
const courseBox = tpl.fields.course || { x: 100, y: 420, w:
img.width-200, h: 100, align: 'center', font: '48px sans-serif' };
const idBox = tpl.fields.id || { x: 50, y: img.height-80, w: 600, h: 40,
align: 'left', font: '20px monospace' };
ctx.fillStyle = '#ffffffff';
fitAndRenderText(ctx, name, nameBox, nameBox.font, nameBox.align);
fitAndRenderText(ctx, course, courseBox, courseBox.font, courseBox.align);
ctx.font = idBox.font;
ctx.textAlign = idBox.align;
ctx.fillText(id, idBox.x + (idBox.align==='center'?idBox.w/2:
(idBox.align==='right'?idBox.w:0) ), idBox.y);
6
// result filename
const slugCourse = slugify(course).substring(0,50);
const slugName = slugify(name).substring(0,50);
const filename = `${id}-${slugCourse}-${slugName}.png`.replace(/\s+/g,'');
const outPath = path.join(OUT_DIR, filename);
const buffer = canv.toBuffer('image/png');
fs.writeFileSync(outPath, buffer);
// append logs
const dt = dayjs().toISOString();
const csvLine = `${dt},${id},"${name}","${course}",${filename},${tpl.hash}
\n`;
fs.appendFileSync(LOG_CSV, csvLine);
fs.appendFileSync(LOG_JSONL, JSON.stringify({ datetime: dt, id, name,
course, filename, template_hash: tpl.hash }) + '\n');
outputs.push({ id, filename, path: outPath });
}
res.json({ ok: true, files: outputs });
} catch (err) {
console.error(err);
res.status(500).send(String(err));
}
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Server started', PORT));