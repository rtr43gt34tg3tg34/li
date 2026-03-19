const express = require('express');
const path    = require('path');

const app  = express();
const PORT = 3000;

const GOOGLE_CLIENT_ID = '881748752116-e7khbn7cuij84hg5c1ss8m0j7q3bsn55.apps.googleusercontent.com';

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/google-client-id', (req, res) => {
  res.json({ clientId: GOOGLE_CLIENT_ID });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log("  ✅  Liam's Websites is running!");
  console.log('  🌐  Open: http://localhost:' + PORT);
  console.log('  🔑  Google Client ID: configured ✓');
  console.log('');
});