// index.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cron = require('node-cron');
const { kv } = require('@vercel/kv');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Fungsi untuk mendapatkan semua sites
async function getAllSites() {
  const sites = await kv.get('sites') || [];
  return sites;
}

// Fungsi untuk menyimpan sites
async function saveSites(sites) {
  await kv.set('sites', sites);
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
  const sites = await getAllSites();
  
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
  
  await saveSites(sites);
});

// Routes
app.get('/', async (req, res) => {
  try {
    const sites = await getAllSites();
    
    const sitesWithStats = sites.map(site => ({
      ...site,
      uptime: calculateUptime(site.checks || []),
      dailyStatus: calculateDailyStatus(site.checks || [])
    }));
    
    res.render('index', { sites: sitesWithStats });
  } catch (err) {
    console.error('Error loading sites:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/add-site', async (req, res) => {
  try {
    const { name, url } = req.body;
    
    // Validasi URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).send('URL must start with http:// or https://');
    }
    
    const sites = await getAllSites();
    
    // Cek apakah site sudah ada
    if (sites.some(s => s.url === url)) {
      return res.status(400).send('Site already monitored');
    }
    
    const newSite = {
      id: Date.now().toString(),
      name,
      url,
      createdAt: new Date().toISOString(),
      checks: [],
      lastStatus: 'unknown',
      responseTime: 0
    };
    
    sites.push(newSite);
    await saveSites(sites);
    
    res.redirect('/');
  } catch (err) {
    console.error('Error adding site:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/delete-site/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let sites = await getAllSites();
    sites = sites.filter(site => site.id !== id);
    await saveSites(sites);
    res.redirect('/');
  } catch (err) {
    console.error('Error deleting site:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/site/:id', async (req, res) => {
  try {
    const sites = await getAllSites();
    const site = sites.find(s => s.id === req.params.id);
    
    if (!site) {
      return res.status(404).send('Site not found');
    }
    
    const stats = calculateStatistics(site);
    res.render('site-details', { site, stats });
  } catch (err) {
    console.error('Error loading site details:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Fungsi statistik
function calculateUptime(checks) {
  if (checks.length === 0) return 100;
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
  const checks = site.checks || [];
  if (checks.length === 0) {
    return {
      uptime24h: 0,
      uptime7d: 0,
      uptime30d: 0,
      avgResponse: 0,
      outages: 0
    };
  }
  
  const now = Date.now();
  const checks24h = checks.filter(c => 
    now - new Date(c.timestamp).getTime() <= 24 * 60 * 60 * 1000
  );
  
  const checks7d = checks.filter(c => 
    now - new Date(c.timestamp).getTime() <= 7 * 24 * 60 * 60 * 1000
  );
  
  const checks30d = checks;
  
  return {
    uptime24h: calculateUptime(checks24h),
    uptime7d: calculateUptime(checks7d),
    uptime30d: calculateUptime(checks30d),
    avgResponse: Math.round(
      checks24h.reduce((sum, c) => sum + c.responseTime, 0) / (checks24h.length || 1)
    ),
    outages: checks.filter(c => c.status === 'down').length
  };
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
