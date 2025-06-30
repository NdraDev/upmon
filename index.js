// index.js (Server Utama)
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 1029;
const DB_PATH = path.join(__dirname, 'sites.json');

// Setup database jika belum ada
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2));
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Baca data situs
function readSites() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

// Simpan data situs
function saveSites(sites) {
  fs.writeFileSync(DB_PATH, JSON.stringify(sites, null, 2));
}

// Fungsi pengecekan situs
async function checkSite(site) {
  try {
    const start = Date.now();
    const response = await axios.get(site.url, { timeout: 10000 });
    const duration = Date.now() - start;
    
    return {
      status: response.status >= 200 && response.status < 400 ? 'up' : 'down',
      responseTime: duration,
      statusCode: response.status
    };
  } catch (error) {
    return {
      status: 'down',
      responseTime: 0,
      statusCode: error.response?.status || 500
    };
  }
}

// Cron job pengecekan setiap 1 menit
cron.schedule('* * * * *', async () => {
  console.log('Running scheduled check...');
  const sites = readSites();
  
  for (const site of sites) {
    const result = await checkSite(site);
    const timestamp = new Date().toISOString();
    
    site.checks = site.checks || [];
    site.checks.push({
      timestamp,
      status: result.status,
      responseTime: result.responseTime,
      statusCode: result.statusCode
    });
    
    // Simpan hanya 500 check terbaru
    if (site.checks.length > 500) {
      site.checks = site.checks.slice(-500);
    }
    
    // Update status terakhir
    site.lastStatus = result.status;
    site.lastCheck = timestamp;
    site.responseTime = result.responseTime;
  }
  
  saveSites(sites);
});

// Routes
app.get('/', (req, res) => {
  const sites = readSites().map(site => ({
    ...site,
    uptime: calculateUptime(site.checks),
    dailyStatus: calculateDailyStatus(site.checks)
  }));
  
  res.render('index', { sites });
});

app.post('/add', (req, res) => {
  const { name, url } = req.body;
  const sites = readSites();
  
  sites.push({
    id: Date.now().toString(),
    name,
    url,
    createdAt: new Date().toISOString(),
    checks: [],
    lastStatus: 'unknown',
    responseTime: 0
  });
  
  saveSites(sites);
  res.redirect('/');
});

app.post('/delete/:id', (req, res) => {
  const { id } = req.params;
  let sites = readSites();
  sites = sites.filter(site => site.id !== id);
  saveSites(sites);
  res.redirect('/');
});

app.get('/site/:id', (req, res) => {
  const sites = readSites();
  const site = sites.find(s => s.id === req.params.id);
  
  if (!site) {
    return res.status(404).send('Site not found');
  }
  
  const stats = calculateStatistics(site);
  res.render('site-details', { site, stats });
});

// Fungsi statistik
function calculateUptime(checks) {
  if (!checks || checks.length === 0) return 100;
  const upCount = checks.filter(c => c.status === 'up').length;
  return (upCount / checks.length * 100).toFixed(2);
}

function calculateDailyStatus(checks) {
  const daily = {};
  checks.forEach(check => {
    const date = check.timestamp.split('T')[0];
    if (!daily[date]) daily[date] = { up: 0, down: 0 };
    daily[date][check.status]++;
  });
  return daily;
}

function calculateStatistics(site) {
  if (!site.checks || site.checks.length === 0) {
    return {
      uptime24h: 0,
      uptime7d: 0,
      uptime30d: 0,
      avgResponse: 0,
      outages: 0
    };
  }
  
  const now = Date.now();
  const checks24h = site.checks.filter(c => 
    now - new Date(c.timestamp).getTime() <= 24 * 60 * 60 * 1000
  );
  
  const checks7d = site.checks.filter(c => 
    now - new Date(c.timestamp).getTime() <= 7 * 24 * 60 * 60 * 1000
  );
  
  const checks30d = site.checks;
  
  return {
    uptime24h: calculateUptime(checks24h),
    uptime7d: calculateUptime(checks7d),
    uptime30d: calculateUptime(checks30d),
    avgResponse: Math.round(
      checks24h.reduce((sum, c) => sum + c.responseTime, 0) / checks24h.length || 0
    ),
    outages: site.checks.filter(c => c.status === 'down').length
  };
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
